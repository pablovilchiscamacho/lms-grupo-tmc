import { createClient } from "@supabase/supabase-js";

/** Cliente con service role para scripts de terminal (lee .env.local vía --env-file). */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY en .env.local");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Resultado obligatorio: termina el script si hay error o viene vacío. */
export function must<T>(r: { data: T; error: unknown }, what: string): NonNullable<T> {
  if (r.error || r.data == null) {
    console.error(`✗ ${what}:`, r.error ?? "sin datos");
    process.exit(1);
  }
  return r.data as NonNullable<T>;
}

/** Resultado opcional (maybeSingle): termina solo si hay error. */
export function maybe<T>(r: { data: T; error: unknown }, what: string): T {
  if (r.error) {
    console.error(`✗ ${what}:`, r.error);
    process.exit(1);
  }
  return r.data;
}
