// Conexión a Postgres de Supabase con las variables de entorno o de .env.local (nunca imprime secretos).
import fs from "node:fs";
import pg from "pg";

export function loadEnv() {
  const env = { ...process.env };
  const file = new URL("../../.env.local", import.meta.url);
  if (fs.existsSync(file)) {
    for (const l of fs.readFileSync(file, "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

export function projectRef(env) {
  return (env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([^.]+)/)?.[1];
}

export async function connect(env, { host, ref } = {}) {
  const r = ref ?? projectRef(env);
  if (!r || !env.SUPABASE_DB_PASSWORD) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_DB_PASSWORD");
  const c = new pg.Client({ host: host ?? env.SUPABASE_DB_HOST ?? "aws-0-us-east-1.pooler.supabase.com", port: 5432,
    user: `postgres.${r}`, password: env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
  await c.connect();
  return { client: c, ref: r, q: async (sql, params) => (await c.query(sql, params)).rows };
}
