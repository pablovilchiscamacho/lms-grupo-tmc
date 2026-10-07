import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

const root = join(__dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

/** Base nueva en memoria con el shim de Supabase y todas las migraciones aplicadas. */
export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pg_trgm, unaccent } });
  await db.exec(readFileSync(join(__dirname, "supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(migrationsDir, f), "utf8"));
    } catch (e) {
      throw new Error(`Migración ${f} falló: ${(e as Error).message}`);
    }
  }
  return db;
}

export type Session = { uid: string | null; aal?: "aal1" | "aal2"; role?: "authenticated" | "anon" | "service_role" };

/** Ejecuta fn dentro de una transacción con el rol y el JWT simulados, como lo haría PostgREST. */
export async function as<T>(db: PGlite, s: Session, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const role = s.role ?? (s.uid ? "authenticated" : "anon");
  return db.transaction(async (tx) => {
    const claims = s.uid ? { sub: s.uid, role, aal: s.aal ?? "aal1" } : { role };
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.query(`set local role ${role}`);
    return fn(tx);
  });
}

/** Atajo: una consulta como cierto usuario. */
export async function q<R = Record<string, unknown>>(db: PGlite, s: Session, sql: string, params: unknown[] = []) {
  return as(db, s, async (tx) => (await tx.query<R>(sql, params)).rows);
}

/** Código de error de negocio (app.fail) o mensaje de Postgres. */
export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "NO_ERROR";
}
