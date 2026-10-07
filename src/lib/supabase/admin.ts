import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

/**
 * Cliente con service role. SOLO servidor, y SOLO después de autorizar con una RPC
 * (patrón P4 de ARCHITECTURE.md): crear/banear usuarios en Auth, resolver logins, bitácora de servidor.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) throw new Error("Falta SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
