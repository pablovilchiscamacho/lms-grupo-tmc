// Arranque del piloto: borra TODOS los datos de prueba y deja la plataforma lista para gente real.
// Conserva: empresas, sucursales, departamentos, puestos, roles, permisos y configuración.
// Antes de borrar saca un respaldo cifrado. Todo lo de la base ocurre en UNA transacción (o todo o nada).
//
//   npm run pilot:reset                                 → solo muestra lo que borraría
//   npm run pilot:reset -- --ejecutar --confirmar <ref> → lo hace
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { dump, encrypt, listTables, plan } from "./lib/backup-core.mjs";
import { connect, loadEnv } from "./lib/db-env.mjs";

const KEEP = new Set(["public.companies", "public.branches", "public.departments", "public.positions",
  "public.roles", "public.permissions", "public.role_permissions", "public.settings"]);
const MFA_ROLES = ["super_admin", "training_admin", "hr_admin"];

const env = loadEnv();
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const run = process.argv.includes("--ejecutar");
const { client, q, ref } = await connect(env);
const ident = (s) => s.split(".").map((p) => `"${p}"`).join(".");

const tables = (await listTables(q)).filter((t) => !t.name.startsWith("auth."));
const wipe = tables.filter((t) => !KEEP.has(t.name));
const counts = {};
for (const t of tables) counts[t.name] = Number((await q(`select count(*)::int n from ${ident(t.name)}`))[0].n);
const users = Number((await q("select count(*)::int n from auth.users"))[0].n);
const files = await q("select bucket, storage_path from public.files");

console.log(`Proyecto ${ref}`);
console.log(`Se conserva: ${[...KEEP].map((k) => `${k.split(".")[1]} (${counts[k]})`).join(", ")}`);
console.log(`Se borra:    ${wipe.filter((t) => counts[t.name]).map((t) => `${t.name.replace("public.", "")} (${counts[t.name]})`).join(", ")}`);
console.log(`             + ${users} cuentas de acceso y ${files.length} archivos de Storage`);
console.log(`Después:     verificación en dos pasos obligatoria para ${MFA_ROLES.join(", ")}`);
if (!run) { console.log("\n(Modo de prueba: no se borró nada. Agrega --ejecutar --confirmar <ref> para hacerlo.)"); await client.end(); process.exit(0); }
if (arg("--confirmar") !== ref) { console.error(`✗ Para ejecutar escribe --confirmar ${ref}`); await client.end(); process.exit(1); }
if (!env.BACKUP_PASSPHRASE || env.BACKUP_PASSPHRASE.length < 16) { console.error("✗ Falta BACKUP_PASSPHRASE: sin respaldo no se borra nada."); process.exit(1); }

// 1) Respaldo previo
await q("begin isolation level repeatable read read only");
const { lines } = await dump(q, { project: ref, reason: "antes del piloto" });
await q("commit");
const enc = encrypt(lines, env.BACKUP_PASSPHRASE);
const dir = path.join(os.homedir(), "Respaldos-LMS");
fs.mkdirSync(dir, { recursive: true });
const backupFile = path.join(dir, `lms-respaldo-antes-del-piloto-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.lmsbk`);
fs.writeFileSync(backupFile, enc, { mode: 0o600 });
const sha = crypto.createHash("sha256").update(enc).digest("hex");
console.log(`✓ Respaldo previo: ${backupFile}`);

// 2) Base de datos (una transacción)
const { order, deferred } = plan(tables);
const del = new Set(wipe.map((t) => t.name));
await q("begin");
try {
  for (const t of tables) await q(`alter table ${ident(t.name)} disable trigger user`);
  // Lo que se conserva y apunta a algo que se borra (logo de empresa, titular de departamento) queda vacío.
  for (const t of tables.filter((x) => KEEP.has(x.name))) {
    for (const f of t.fks.filter((f) => del.has(f.ref))) {
      for (const c of f.cols) await q(`update ${ident(t.name)} set "${c}" = null where "${c}" is not null`);
    }
  }
  if ((await q("select count(*)::int n from public.settings where updated_by is not null"))[0].n) await q("update public.settings set updated_by = null");
  // Referencias opcionales en ciclo (curso ↔ versión, jefe) se vacían antes de borrar.
  for (const [name, cols] of Object.entries(deferred)) {
    if (!del.has(name)) continue;
    const t = tables.find((x) => x.name === name);
    for (const c of cols.filter((c) => !t.cols.find((x) => x.name === c)?.notnull)) await q(`update ${ident(name)} set "${c}" = null where "${c}" is not null`);
  }
  for (const t of [...order].reverse()) if (del.has(t.name)) await q(`delete from ${ident(t.name)}`);
  await q("delete from auth.users");
  for (const s of await q(`select pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) seq
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'app', 'audit') and a.attnum > 0 and pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) is not null`)) {
    const t = s.seq;   // solo se reinician las de tablas vaciadas
    const owner = (await q(`select n.nspname || '.' || c.relname t from pg_depend d join pg_class c on c.oid = d.refobjid join pg_namespace n on n.oid = c.relnamespace where d.objid = $1::regclass and d.deptype in ('a','i')`, [t]))[0]?.t;
    if (owner && del.has(owner)) await q("select setval($1, 1, false)", [t]);
  }
  await q("update public.roles set requires_mfa = true where key = any ($1)", [MFA_ROLES]);
  for (const t of tables) await q(`alter table ${ident(t.name)} enable trigger user`);
  await q("select app.log('system.pilot_reset', 'system', null, null, null, $1::jsonb)",
    [JSON.stringify({ note: "Se borraron los datos de prueba antes del piloto", backup_sha256: sha, deleted: Object.fromEntries(wipe.map((t) => [t.name, counts[t.name]])), auth_users: users })]);
  await q("commit");
} catch (e) {
  await q("rollback");
  console.error("✗ No se borró nada de la base:", e.message);
  process.exit(1);
}
await client.end();
console.log("✓ Base de datos limpia");

// 3) Archivos de Storage
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const byBucket = Object.groupBy(files, (f) => f.bucket);
for (const [bucket, list] of Object.entries(byBucket)) {
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await sb.storage.from(bucket).remove(list.slice(i, i + 100).map((f) => f.storage_path));
    if (error) console.error(`  ! ${bucket}: ${error.message}`);
  }
}
console.log(`✓ ${files.length} archivos borrados de Storage`);
console.log("Listo. Siguiente: npm run bootstrap:admin para crear al Super Admin real.");
