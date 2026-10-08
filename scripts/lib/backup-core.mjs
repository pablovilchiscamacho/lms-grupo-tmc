// Núcleo de respaldo y restauración lógica (datos), independiente del cliente de Postgres.
// `q(sql, params)` debe devolver un arreglo de filas. Lo usan scripts/db-backup.mjs, scripts/db-restore.mjs
// y la prueba tests/db/backup.test.ts (con PGlite).
//
// El esquema NO va en el respaldo: lo crean las migraciones (supabase/migrations). El respaldo lleva los datos de
// public, app y audit, más auth.users / auth.identities (para que la gente conserve su acceso).
// Formato: primera línea {manifest}; luego una línea por fila: «esquema.tabla<TAB>{fila en JSON}».
// La fila viaja como TEXTO exacto de Postgres (nunca se reinterpreta en JavaScript): así 80.00 sigue siendo 80.00
// y la cadena de hash de la bitácora se verifica igual después de restaurar.

import crypto from "node:crypto";
import zlib from "node:zlib";

export const SCHEMAS = ["public", "app", "audit"];
const EXTRA = ["auth.users", "auth.identities"];
const SKIP = new Set(["app.rate_limits"]);   // efímero
const BATCH = 2000;

const ident = (s) => `"${s.replace(/"/g, '""')}"`;
const qname = (full) => full.split(".").map(ident).join(".");

/** Tablas a respaldar, con columnas, llave primaria y llaves foráneas. */
export async function listTables(q) {
  const tables = await q(`
    select n.nspname || '.' || c.relname as name, c.oid::int as oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and (n.nspname = any ($1) or (n.nspname || '.' || c.relname) = any ($2))
    order by 1`, [SCHEMAS, EXTRA]);
  const out = [];
  for (const t of tables) {
    if (SKIP.has(t.name)) continue;
    const cols = await q(`
      select a.attname as name, a.attgenerated <> '' as generated, a.attidentity = 'a' as identity_always, a.attnotnull as notnull
      from pg_attribute a where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped order by a.attnum`, [t.oid]);
    const pk = await q(`
      select a.attname as name from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
      where i.indrelid = $1 and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`, [t.oid]);
    const fks = await q(`
      select (select array_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) as cols,
             rn.nspname || '.' || rc.relname as ref
      from pg_constraint c join pg_class rc on rc.oid = c.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
      where c.conrelid = $1 and c.contype = 'f'`, [t.oid]);
    out.push({ name: t.name, cols, pk: pk.map((p) => p.name), fks: fks.map((f) => ({ cols: toArray(f.cols), ref: f.ref })) });
  }
  return out;
}
const toArray = (v) => (Array.isArray(v) ? v : String(v).replace(/^\{|\}$/g, "").split(",").filter(Boolean));

/** Lee todos los datos. Devuelve { manifest, lines } (lines = arreglo de strings NDJSON). */
export async function dump(q, meta = {}) {
  const tables = await listTables(q);
  const lines = [];
  const counts = /** @type {Record<string, number>} */ ({});
  for (const t of tables) {
    const order = t.pk.length ? t.pk.map(ident).join(", ") : "1";
    let n = 0;
    for (let off = 0; ; off += BATCH) {
      const rows = await q(`select to_jsonb(x)::text as r from (select * from ${qname(t.name)} order by ${order} limit ${BATCH} offset ${off}) x`);
      for (const { r } of rows) lines.push(`${t.name}\t${r}`);
      n += rows.length;
      if (rows.length < BATCH) break;
    }
    counts[t.name] = n;
  }
  const migrations = (await q(`select to_regclass('supabase_migrations.schema_migrations') is not null as ok`))[0].ok
    ? (await q(`select version from supabase_migrations.schema_migrations order by 1`)).map((m) => m.version)
    : [];
  const manifest = { format: "lms-backup", version: 1, created_at: new Date().toISOString(), counts, migrations, ...meta };
  return { manifest, lines: [JSON.stringify({ manifest }), ...lines] };
}

/**
 * Orden de inserción: primero se ordenan las llaves OBLIGATORIAS (NOT NULL), que no forman ciclos.
 * Las opcionales que apuntan a una tabla posterior (o a sí misma: jefe, padre) se insertan vacías y se llenan al final.
 */
export function plan(tables) {
  const names = new Set(tables.map((t) => t.name));
  const hard = (t, f) => f.ref !== t.name && names.has(f.ref) && f.cols.every((c) => t.cols.find((x) => x.name === c)?.notnull);
  const done = new Set();
  const order = [];
  const pending = [...tables];
  while (pending.length) {
    const i = pending.findIndex((t) => t.fks.every((f) => !hard(t, f) || done.has(f.ref)));
    if (i === -1) throw new Error(`Ciclo de llaves obligatorias entre: ${pending.map((t) => t.name).join(", ")}`);
    const [t] = pending.splice(i, 1);
    done.add(t.name);
    order.push(t);
  }
  const pos = new Map(order.map((t, i) => [t.name, i]));
  const deferred = /** @type {Record<string, string[]>} */ ({});
  for (const t of order) {
    const late = t.fks.filter((f) => names.has(f.ref) && !hard(t, f) && pos.get(f.ref) >= pos.get(t.name)).flatMap((f) => f.cols);
    if (late.length) deferred[t.name] = [...new Set(late)];
  }
  return { order, deferred };
}

/** Restaura sobre una base con las migraciones ya aplicadas. BORRA los datos actuales de esas tablas. */
export async function restore(q, lines, log = () => {}) {
  const head = JSON.parse(lines[0]);
  if (head?.manifest?.format !== "lms-backup") throw new Error("No es un respaldo del LMS");
  const byTable = new Map();
  for (const l of lines.slice(1)) {
    if (!l) continue;
    const tab = l.indexOf("\t");
    const t = l.slice(0, tab);
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t).push(l.slice(tab + 1));
  }
  const batch = (rows, i) => `[${rows.slice(i, i + 500).join(",")}]`;
  const tables = (await listTables(q)).filter((t) => head.manifest.counts[t.name] !== undefined);
  const { order, deferred } = plan(tables);
  const ours = tables.filter((t) => !t.name.startsWith("auth."));

  await q("begin");
  try {
    for (const t of ours) await q(`alter table ${qname(t.name)} disable trigger user`);
    await q(`truncate ${tables.map((t) => qname(t.name)).join(", ")} restart identity cascade`);
    for (const t of order) {
      const rows = byTable.get(t.name) ?? [];
      if (!rows.length) continue;
      const late = new Set(deferred[t.name] ?? []);
      const cols = t.cols.filter((c) => !c.generated);
      const list = cols.map((c) => ident(c.name)).join(", ");
      const sel = cols.map((c) => (late.has(c.name) && !c.notnull ? `null` : `x.${ident(c.name)}`)).join(", ");
      const over = cols.some((c) => c.identity_always) ? " overriding system value" : "";
      for (let i = 0; i < rows.length; i += 500) {
        await q(`insert into ${qname(t.name)} (${list})${over} select ${sel} from jsonb_populate_recordset(null::${qname(t.name)}, $1::text::jsonb) x`,
          [batch(rows, i)]);
      }
      log(`${t.name}: ${rows.length}`);
    }
    for (const [name, cols] of Object.entries(deferred)) {
      const t = tables.find((x) => x.name === name);
      const rows = byTable.get(name) ?? [];
      const nullable = cols.filter((c) => !t.cols.find((x) => x.name === c).notnull);
      if (!rows.length || !nullable.length) continue;
      if (!t.pk.length) throw new Error(`No se puede completar ${name}: no tiene llave primaria`);
      const set = nullable.map((c) => `${ident(c)} = x.${ident(c)}`).join(", ");
      const on = t.pk.map((c) => `t.${ident(c)} = x.${ident(c)}`).join(" and ");
      for (let i = 0; i < rows.length; i += 500) {
        await q(`update ${qname(name)} t set ${set} from jsonb_populate_recordset(null::${qname(name)}, $1::text::jsonb) x where ${on}`, [batch(rows, i)]);
      }
    }
    // Secuencias (identidades) al máximo restaurado.
    const seqs = await q(`
      select n.nspname || '.' || c.relname as tbl, a.attname as col, pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) as seq
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any ($1) and c.relkind in ('r','p') and a.attnum > 0 and pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) is not null`, [SCHEMAS]);
    for (const s of seqs) await q(`select setval($1, greatest(coalesce((select max(${ident(s.col)}) from ${qname(s.tbl)}), 0), 1), (select count(*) > 0 from ${qname(s.tbl)}))`, [s.seq]);
    for (const t of ours) await q(`alter table ${qname(t.name)} enable trigger user`);
    await q("commit");
  } catch (e) {
    await q("rollback");
    throw e;
  }
  const check = /** @type {Record<string, number>} */ ({});
  for (const t of tables) check[t.name] = Number((await q(`select count(*)::int as n from ${qname(t.name)}`))[0].n);
  const mismatched = Object.entries(head.manifest.counts).filter(([k, v]) => check[k] !== undefined && check[k] !== v);
  return { manifest: head.manifest, counts: check, mismatched };
}

// --------------------------------------------------------------- cifrado (AES-256-GCM, clave derivada con scrypt)
const MAGIC = Buffer.from("LMSBK1");
export function encrypt(lines, passphrase) {
  if (!passphrase || passphrase.length < 16) throw new Error("La frase de respaldo debe tener al menos 16 caracteres");
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(lines.join("\n")))), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}
export function decrypt(buf, passphrase) {
  if (!buf.subarray(0, 6).equals(MAGIC)) throw new Error("Archivo de respaldo no reconocido");
  const salt = buf.subarray(6, 22), iv = buf.subarray(22, 34), tag = buf.subarray(34, 50), body = buf.subarray(50);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return zlib.gunzipSync(Buffer.concat([d.update(body), d.final()])).toString("utf8").split("\n");
}
