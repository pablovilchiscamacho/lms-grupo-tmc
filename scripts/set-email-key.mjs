// Guarda RESEND_API_KEY (de .env.local) cifrada en Supabase Vault como 'resend_api_key'.
// Nunca imprime la clave. Uso: npm run email:key
import fs from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const key = env.RESEND_API_KEY;
if (!key || !/^re_[A-Za-z0-9_]{10,}$/.test(key)) {
  console.error("✗ Falta RESEND_API_KEY en .env.local (debe empezar con re_).");
  process.exit(1);
}
const ref = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)/)[1];
const c = new pg.Client({ host: env.SUPABASE_DB_HOST, port: 5432, user: `postgres.${ref}`, password: env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query("select id from vault.secrets where name = 'resend_api_key'");
if (rows.length) await c.query("select vault.update_secret($1, $2)", [rows[0].id, key]);
else await c.query("select vault.create_secret($1, 'resend_api_key', 'Clave de Resend para los correos del LMS')", [key]);
await c.end();
console.log(`✓ Clave de Resend guardada en Supabase Vault (termina en …${key.slice(-4)}).`);
