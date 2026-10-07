import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/types/context";

/** Contexto del usuario actual (perfil, permisos vigentes, roles). Una sola consulta por petición. */
export const getContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return null;
  const { data, error } = await supabase.rpc("my_context");
  if (error) {
    console.error("[my_context]", error);
    return null;
  }
  return (data as SessionContext | null) ?? null;
});

export const can = (ctx: SessionContext, perm: string) => ctx.permissions.includes(perm);
export const canAny = (ctx: SessionContext, perms: string[]) => perms.some((p) => ctx.permissions.includes(p));

/** Usuario con sesión, activo y sin cambio de contraseña pendiente. */
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/entrar");
  if (ctx.profile.status !== "active") redirect("/salir?motivo=inactivo");
  if (ctx.profile.must_change_password && !opts.allowPasswordChange) redirect("/definir-contrasena?motivo=obligatorio");
  return ctx;
}

/** Área de administración: exige MFA si alguno de sus roles lo requiere, y al menos un permiso administrativo. */
export async function requireAdmin(nextPath = "/admin"): Promise<SessionContext> {
  const ctx = await requireUser();
  if (ctx.requires_mfa && ctx.aal !== "aal2") redirect(`/mfa?next=${encodeURIComponent(nextPath)}`);
  if (ctx.permissions.length === 0) redirect("/");
  return ctx;
}

/** Igual que requireAdmin, y además el permiso indicado (en cualquier alcance; RLS hace el resto). */
export async function requirePermission(perm: string | string[], nextPath?: string): Promise<SessionContext> {
  const ctx = await requireAdmin(nextPath);
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!canAny(ctx, perms)) redirect("/admin?sin-permiso=1");
  return ctx;
}
