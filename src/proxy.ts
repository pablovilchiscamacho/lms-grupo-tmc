import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { isSupabaseConfigured } from "@/lib/env";

const PUBLIC = [/^\/entrar/, /^\/recuperar/, /^\/auth\//, /^\/verify\//, /^\/configuracion-pendiente/, /^\/api\/(health|jobs)/];

/**
 * Chequeo optimista: refresca la sesión y manda a /entrar si no hay sesión.
 * La autorización real ocurre en el servidor (RLS + RPC); esto solo evita pantallas vacías.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isSupabaseConfigured()) {
    if (pathname.startsWith("/configuracion-pendiente")) return NextResponse.next();
    return NextResponse.redirect(new URL("/configuracion-pendiente", request.url));
  }
  const { response, claims } = await updateSession(request);
  if (!claims && !PUBLIC.some((r) => r.test(pathname))) {
    const url = new URL("/entrar", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  response.headers.set("x-request-id", crypto.randomUUID());
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|svg|ico|jpg|jpeg|webp)$).*)"],
};
