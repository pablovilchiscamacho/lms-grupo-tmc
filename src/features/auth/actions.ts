"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe, UserError, type ActionResult } from "@/lib/action";
import { APP_URL } from "@/lib/env";

const GENERIC = "Usuario o contraseña incorrectos.";

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "local").split(",")[0].trim();
}

/** Solo rutas internas como destino después de entrar (evita redirecciones abiertas). */
function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

const signInSchema = z.object({
  identifier: z.string().trim().min(1, "Escribe tu correo o número de empleado").max(200),
  password: z.string().min(1, "Escribe tu contraseña").max(200),
});

/** Entrar con correo, usuario o número de empleado (D1). */
export async function signIn(_: unknown, fd: FormData): Promise<ActionResult> {
  let destination = "/";
  const result = await safe(async () => {
    const { identifier, password } = signInSchema.parse({ identifier: fd.get("identifier"), password: fd.get("password") });
    const admin = createAdminClient();
    const ip = await clientIp();
    const key = identifier.toLowerCase();

    const [byIp, byId] = await Promise.all([
      admin.rpc("hit_rate_limit", { p_key: `login:ip:${ip}`, p_limit: 20, p_window_seconds: 60 }),
      admin.rpc("hit_rate_limit", { p_key: `login:id:${key}`, p_limit: 5, p_window_seconds: 60 }),
    ]);
    if (byIp.data === false || byId.data === false) throw new UserError("Demasiados intentos. Espera un minuto e inténtalo de nuevo.", "RATE_LIMITED");

    const { data: resolved } = await admin.rpc("resolve_login", { p_identifier: identifier });
    const target = resolved as { auth_email: string; status: string } | null;
    if (!target || target.status !== "active") {
      await admin.rpc("server_log", { p_actor: null, p_action: "auth.login_failed", p_entity_type: "user", p_data: { identifier: key.slice(0, 80), ip } });
      // Mismo mensaje exista o no la cuenta, para no revelar quién está registrado.
      throw new UserError(GENERIC, "AUTH");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: target.auth_email, password });
    if (error || !data.user) {
      await admin.rpc("server_log", { p_actor: null, p_action: "auth.login_failed", p_entity_type: "user", p_data: { identifier: key.slice(0, 80), ip } });
      throw new UserError(GENERIC, "AUTH");
    }
    await Promise.all([
      admin.rpc("server_mark_user", { p_user_id: data.user.id, p_event: "login" }),
      supabase.rpc("log_session_event", { p_action: "auth.login" }),
    ]);
    destination = safeNext(fd.get("next"));
  });
  if (!result.ok) return result;
  redirect(destination);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.rpc("log_session_event", { p_action: "auth.logout" });
  await supabase.auth.signOut();
  redirect("/entrar");
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email("Escribe un correo válido") });

/** "Olvidé mi contraseña": misma respuesta exista o no la cuenta (no revela quién está registrado). */
export async function requestPasswordReset(_: unknown, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const { email } = emailSchema.parse({ email: fd.get("email") });
    const admin = createAdminClient();
    const ip = await clientIp();
    const { data: allowed } = await admin.rpc("hit_rate_limit", { p_key: `reset:${ip}`, p_limit: 5, p_window_seconds: 300 });
    if (allowed === false) throw new UserError("Demasiadas solicitudes. Inténtalo en unos minutos.", "RATE_LIMITED");

    const { data: resolved } = await admin.rpc("resolve_login", { p_identifier: email });
    const target = resolved as { auth_email: string; status: string } | null;
    // Solo se envía a cuentas activas con correo real (el correo técnico nunca recibe mensajes).
    if (target && target.status === "active" && target.auth_email === email) {
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${APP_URL}/auth/confirm?next=/definir-contrasena`,
      });
    }
    return { ok: true, message: "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña. Revisa también tu carpeta de spam." };
  });
}

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(10, "Mínimo 10 caracteres")
      .max(72, "Máximo 72 caracteres")
      .refine((v) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v) && /\d/.test(v), "Usa letras y números"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden" });

/** Definir contraseña: invitación, recuperación o cambio obligatorio en el primer acceso. */
export async function setPassword(_: unknown, fd: FormData): Promise<ActionResult> {
  const result = await safe(async () => {
    const { password } = passwordSchema.parse({ password: fd.get("password"), confirm: fd.get("confirm") });
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const uid = claims?.claims?.sub;
    if (!uid) throw new UserError("Tu enlace expiró. Solicita uno nuevo.", "AUTH");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === "same_password") throw new UserError("La nueva contraseña debe ser distinta a la anterior.");
      if (error.code === "weak_password") throw new UserError("La contraseña es muy débil o aparece en filtraciones conocidas. Elige otra.");
      throw error;
    }
    const admin = createAdminClient();
    await admin.rpc("server_mark_user", { p_user_id: uid, p_event: "password_changed" });
    await admin.rpc("server_log", { p_actor: uid, p_action: "auth.password_changed", p_entity_type: "user", p_entity_id: uid });
  });
  if (!result.ok) return result;
  redirect("/?contrasena=actualizada");
}

/** Registra en bitácora la verificación o alta de MFA (la verificación la hace Supabase Auth en el navegador). */
export async function logMfa(kind: "enrolled" | "verified") {
  const supabase = await createClient();
  await supabase.rpc("log_session_event", { p_action: kind === "enrolled" ? "auth.mfa_enrolled" : "auth.mfa_verified" });
}
