// Aplica las migraciones pendientes de supabase/migrations directamente en la base (sin pegar SQL a mano).
// Usa SUPABASE_DB_PASSWORD de .env.local; nunca imprime la contraseña.
//   npm run db:migrate            → aplica lo pendiente
//   npm run db:migrate -- --status → solo muestra qué falta
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const password = process.env.SUPABASE_DB_PASSWORD ?? "";
if (!ref || !password) { console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_DB_PASSWORD en .env.local"); process.exit(1); }

const hosts = [process.env.SUPABASE_DB_HOST, "aws-0-us-east-1.pooler.supabase.com", "aws-1-us-east-1.pooler.supabase.com", "aws-0-us-east-2.pooler.supabase.com"].filter(Boolean);
let client;
for (const host of hosts) {
  const c = new pg.Client({ host, port: 5432, user: `postgres.${ref}`, password, database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try { await c.connect(); client = c; console.log(`Conectado (${host})`); break; }
  catch (e) {
    if (/password authentication failed/i.test(e.message)) { console.error("✗ La contraseña de la base no es correcta."); process.exit(1); }
    await c.end().catch(() => {});
  }
}
if (!client) { console.error("✗ No se pudo conectar a la base."); process.exit(1); }

// Misma tabla que usa la CLI de Supabase, para que ambas herramientas coincidan.
await client.query(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
const applied = new Set((await client.query("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version));

// Arranque: las migraciones que se aplicaron pegándolas en el SQL Editor se registran si sus objetos ya existen.
const probes = { "20261007000001": "app.norm(text)", "20261007000008": "public.create_course(jsonb)", "20261007000009": "public.track_lesson(uuid,text,jsonb)", "20261007000011": "public.save_question(jsonb)", "20261007000012": "public.start_attempt(uuid,text)" };
const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
if (applied.size === 0) {
  let lastExisting = null;
  for (const [v, fn] of Object.entries(probes)) {
    const r = await client.query("select to_regprocedure($1) is not null as ok", [fn]);
    if (r.rows[0].ok) lastExisting = v;
  }
  if (lastExisting) {
    for (const f of files) {
      const v = f.split("_")[0];
      if (v <= lastExisting || (lastExisting >= "20261007000009" && v === "20261007000010")) {
        await client.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict do nothing", [v, f.replace(/^\d+_|\.sql$/g, "")]);
        applied.add(v);
      }
    }
    console.log(`Registradas como ya aplicadas: hasta ${lastExisting}`);
  }
}

const pending = files.filter((f) => !applied.has(f.split("_")[0]));
if (process.argv.includes("--status")) { console.log(pending.length ? `Pendientes:\n  ${pending.join("\n  ")}` : "Todo al día."); await client.end(); process.exit(0); }
if (!pending.length) { console.log("✓ La base ya está al día."); await client.end(); process.exit(0); }

for (const f of pending) {
  const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
  const v = f.split("_")[0];
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [v, f.replace(/^\d+_|\.sql$/g, "")]);
    await client.query("commit");
    console.log(`✓ ${f}`);
  } catch (e) {
    await client.query("rollback");
    console.error(`✗ ${f}: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log("✓ Migraciones aplicadas.");
