import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino de los enlaces de correo de Supabase Auth (invitación y recuperación).
 * Plantillas: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|recovery&next=/definir-contrasena
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const nextRaw = url.searchParams.get("next") ?? "/definir-contrasena";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;

  return NextResponse.redirect(new URL(ok ? next : "/entrar?motivo=expirado", request.url));
}
