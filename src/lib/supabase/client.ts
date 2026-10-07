"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

/** Cliente del navegador. Solo se usa para MFA (enrolar/verificar), que requiere la sesión del usuario. */
export const createBrowserSupabase = () => createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
