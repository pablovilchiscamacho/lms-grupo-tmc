import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/** Dominio público para el QR: NEXT_PUBLIC_APP_URL, el dominio de producción de Vercel o el de la petición. */
export async function siteUrl() {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env && !/localhost/.test(env)) return env.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

export const verifyUrl = (base: string, code: string) => `${base}/verify/certificate/${code}`;

/** Límite de consultas a la verificación pública por IP (30 por minuto). */
export async function verifyAllowed() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "desconocida";
  const { data, error } = await createAdminClient().rpc("hit_rate_limit", { p_key: `verify:${ip}`, p_limit: 30, p_window_seconds: 60 });
  return error ? true : Boolean(data);
}
