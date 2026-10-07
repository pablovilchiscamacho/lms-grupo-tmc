import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Cierra la sesión (también se usa cuando la cuenta ya no está activa). */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    await supabase.rpc("log_session_event", { p_action: "auth.logout" });
    await supabase.auth.signOut();
  }
  const motivo = request.nextUrl.searchParams.get("motivo") === "inactivo" ? "inactivo" : "salida";
  return NextResponse.redirect(new URL(`/entrar?motivo=${motivo}`, request.url));
}
