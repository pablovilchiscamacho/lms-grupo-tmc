/** Variables públicas (disponibles en el navegador). Las secretas viven en supabase/admin.ts (server-only). */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
