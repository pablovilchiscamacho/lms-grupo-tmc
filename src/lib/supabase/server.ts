import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Cliente de Supabase con la sesión (JWT) del usuario: todo lo que hace pasa por RLS.
 * Envía IP, user agent y un id de petición para que la bitácora los registre (ARCHITECTURE.md §5).
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // En Server Components no se pueden escribir cookies; el proxy refresca la sesión.
        }
      },
    },
    global: {
      headers: {
        "x-client-ip": ip.slice(0, 64),
        "x-client-ua": (h.get("user-agent") ?? "").slice(0, 400),
        "x-request-id": h.get("x-request-id") ?? crypto.randomUUID(),
      },
    },
  });
});
