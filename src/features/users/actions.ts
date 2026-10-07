"use server";
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { must, safe, UserError, type ActionResult } from "@/lib/action";
import { toFriendlyError } from "@/lib/errors";
import { APP_URL } from "@/lib/env";
import { norm } from "@/lib/format";
import { userFromForm, type UserInput } from "./schemas";

const INTERNAL_DOMAIN = process.env.INTERNAL_EMAIL_DOMAIN ?? "users.lms.internal";

/** Contraseña temporal legible (sin 0/O/1/l) para entregar en persona. */
function tempPassword() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ", d = "23456789", all = A + d + "abcdefghjkmnpqrstuvwxyz";
  const pick = (s: string) => s[randomInt(s.length)];
  return `${pick(A)}${Array.from({ length: 4 }, () => pick(all)).join("")}-${pick(d)}${Array.from({ length: 4 }, () => pick(all)).join("")}`;
}
const syntheticEmail = () => `${crypto.randomUUID()}@${INTERNAL_DOMAIN}`;

async function validate(payload: Record<string, unknown>, userId: string | null) {
  const supabase = await createClient();
  const res = await supabase.rpc("admin_validate_user", { p: payload, p_user_id: userId });
  if (res.error) throw res.error;
  const errs = res.data as Record<string, string>;
  if (Object.keys(errs).length) {
    const f = toFriendlyError({ code: "P0001", message: "VALIDATION", details: JSON.stringify(errs) });
    throw new UserError(f.message, "VALIDATION", f.fieldErrors);
  }
}

const accessSchema = z.enum(["invite", "temp"]);

export type CreateUserResult = { id: string; tempPassword?: string; invited?: boolean };

/** Alta de usuario (§58): Auth (service role) → perfil (RPC con el JWT del admin, que valida permisos) → bitácora. */
export async function createUser(_: unknown, fd: FormData): Promise<ActionResult<CreateUserResult>> {
  return safe(async () => {
    const input = userFromForm(fd);
    const access = accessSchema.parse(fd.get("access") ?? "temp");
    if (access === "invite" && !input.has_real_email) throw new UserError("Para enviar invitación se necesita correo corporativo.", "VALIDATION", { email: "Obligatorio para invitar" });
    const payload: Record<string, unknown> = { ...input, auth_email: input.has_real_email ? input.email : syntheticEmail() };
    await validate(payload, null);

    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: me } = await supabase.auth.getClaims();
    let authId: string;
    let temp: string | undefined;

    if (access === "invite") {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(String(payload.auth_email), {
        redirectTo: `${APP_URL}/auth/confirm?next=/definir-contrasena`,
      });
      if (error || !data.user) {
        console.error("[invite]", error);
        throw new UserError("No se pudo enviar la invitación (¿está configurado el correo de Supabase?). Puedes crear al usuario con contraseña temporal.");
      }
      authId = data.user.id;
    } else {
      temp = tempPassword();
      const { data, error } = await admin.auth.admin.createUser({ email: String(payload.auth_email), password: temp, email_confirm: true });
      if (error || !data.user) {
        console.error("[createUser]", error);
        throw new UserError(error?.code === "email_exists" ? "Este correo ya está registrado." : "No se pudo crear el acceso del usuario.");
      }
      authId = data.user.id;
      payload.must_change_password = true;
    }

    const created = await supabase.rpc("admin_create_user", { p_user_id: authId, p: payload });
    if (created.error) {
      await admin.auth.admin.deleteUser(authId); // compensación: no dejar cuentas de Auth sin perfil
      throw created.error;
    }
    if (access === "invite") {
      await admin.rpc("server_log", { p_actor: me?.claims?.sub ?? null, p_action: "user.invited", p_entity_type: "user", p_entity_id: authId });
    }
    revalidatePath("/admin/usuarios");
    return { ok: true, data: { id: authId, tempPassword: temp, invited: access === "invite" } };
  });
}

/** Edición. Si cambia el correo de acceso, primero se actualiza Auth y se revierte si la base rechaza el cambio. */
export async function updateUser(userId: string, _: unknown, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const input: UserInput = userFromForm(fd);
    const supabase = await createClient();
    const { data: cur, error } = await supabase.from("profiles").select("auth_email, has_real_email").eq("id", userId).single();
    if (error) throw error;
    const newAuth = input.has_real_email ? input.email! : cur.has_real_email ? syntheticEmail() : cur.auth_email;
    const payload = { ...input, auth_email: newAuth };
    await validate(payload, userId);

    const admin = createAdminClient();
    const authChanged = newAuth.toLowerCase() !== String(cur.auth_email).toLowerCase();
    if (authChanged) {
      must(await supabase.rpc("admin_check_user_action", { p_user_id: userId, p_perm: "users.update" }));
      const r = await admin.auth.admin.updateUserById(userId, { email: newAuth, email_confirm: true });
      if (r.error) throw new UserError(r.error.code === "email_exists" ? "Este correo ya está registrado." : "No se pudo actualizar el correo de acceso.");
    }
    const upd = await supabase.rpc("admin_update_user", { p_user_id: userId, p: payload });
    if (upd.error) {
      if (authChanged) await admin.auth.admin.updateUserById(userId, { email: cur.auth_email, email_confirm: true });
      throw upd.error;
    }
    revalidatePath(`/admin/usuarios/${userId}`);
    revalidatePath("/admin/usuarios");
    return { ok: true, message: "Cambios guardados." };
  });
}

const statusSchema = z.object({
  status: z.enum(["active", "inactive", "suspended", "deleted"]),
  reason: z.string().trim().min(3, "Escribe el motivo").max(300),
});

/** Cambio de estado + bloqueo/desbloqueo en Auth. El historial académico nunca se borra. */
export async function setUserStatus(userId: string, _: unknown, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const { status, reason } = statusSchema.parse({ status: fd.get("status"), reason: fd.get("reason") });
    const supabase = await createClient();
    must(await supabase.rpc("admin_set_user_status", { p_user_id: userId, p_status: status, p_reason: reason }));
    const admin = createAdminClient();
    const ban = await admin.auth.admin.updateUserById(userId, { ban_duration: status === "active" ? "none" : "876000h" });
    const { data: me } = await supabase.auth.getClaims();
    await admin.rpc("server_log", {
      p_actor: me?.claims?.sub ?? null, p_action: "user.ban_changed", p_entity_type: "user", p_entity_id: userId,
      p_data: { banned: status !== "active", ok: !ban.error },
    });
    if (ban.error) throw new UserError("El estado se guardó, pero no se pudo actualizar el bloqueo de acceso. Inténtalo de nuevo.");
    revalidatePath(`/admin/usuarios/${userId}`);
    revalidatePath("/admin/usuarios");
    return { ok: true, message: "Estado actualizado." };
  });
}

/** Restablecer acceso: enlace por correo (si tiene correo real) o contraseña temporal que se muestra una sola vez. */
export async function resetUserPassword(userId: string, mode: "link" | "temp"): Promise<ActionResult<{ tempPassword?: string }>> {
  return safe(async () => {
    const supabase = await createClient();
    must(await supabase.rpc("admin_check_user_action", { p_user_id: userId, p_perm: "users.update" }));
    const { data: target, error } = await supabase.from("profiles").select("auth_email, has_real_email, status").eq("id", userId).single();
    if (error) throw error;
    if (target.status !== "active") throw new UserError("El usuario no está activo.");
    const admin = createAdminClient();
    const { data: me } = await supabase.auth.getClaims();
    if (mode === "link") {
      if (!target.has_real_email) throw new UserError("El usuario no tiene correo corporativo; usa contraseña temporal.");
      const r = await supabase.auth.resetPasswordForEmail(target.auth_email, { redirectTo: `${APP_URL}/auth/confirm?next=/definir-contrasena` });
      if (r.error) throw new UserError("No se pudo enviar el correo. Revisa la configuración de correo o usa contraseña temporal.");
      await admin.rpc("server_log", { p_actor: me?.claims?.sub ?? null, p_action: "user.password_reset", p_entity_type: "user", p_entity_id: userId, p_data: { mode } });
      return { ok: true, message: "Enviamos un enlace para restablecer la contraseña." };
    }
    const temp = tempPassword();
    const r = await admin.auth.admin.updateUserById(userId, { password: temp });
    if (r.error) throw new UserError("No se pudo asignar la contraseña temporal.");
    await admin.rpc("server_mark_user", { p_user_id: userId, p_event: "password_reset_by_admin" });
    await admin.rpc("server_log", { p_actor: me?.claims?.sub ?? null, p_action: "user.password_reset", p_entity_type: "user", p_entity_id: userId, p_data: { mode } });
    return { ok: true, data: { tempPassword: temp } };
  });
}

const grantSchema = z.object({
  role: z.string().regex(/^[a-z_]{3,40}$/),
  scope_type: z.enum(["group", "company", "branch", "department", "team"]),
  scope_id: z.string().trim().transform((v) => (v === "" ? null : v)).nullable(),
  expires_at: z.string().trim().transform((v) => (v === "" ? null : v)).nullable(),
});

export async function grantRole(userId: string, _: unknown, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const v = grantSchema.parse({ role: fd.get("role"), scope_type: fd.get("scope_type"), scope_id: fd.get("scope_id") ?? "", expires_at: fd.get("expires_at") ?? "" });
    if (["company", "branch", "department"].includes(v.scope_type) && !v.scope_id) throw new UserError("Elige el ámbito del rol.", "VALIDATION", { scope_id: "Obligatorio" });
    const supabase = await createClient();
    must(await supabase.rpc("admin_grant_role", {
      p_user_id: userId, p_role_key: v.role, p_scope_type: v.scope_type, p_scope_id: v.scope_id,
      p_expires_at: v.expires_at ? new Date(`${v.expires_at}T23:59:59-06:00`).toISOString() : null,
    }));
    revalidatePath(`/admin/usuarios/${userId}`);
    return { ok: true, message: "Rol asignado." };
  });
}

export async function revokeRole(userId: string, userRoleId: string): Promise<ActionResult> {
  return safe(async () => {
    const supabase = await createClient();
    must(await supabase.rpc("admin_revoke_role", { p_user_role_id: userRoleId }));
    revalidatePath(`/admin/usuarios/${userId}`);
    return { ok: true, message: "Rol revocado." };
  });
}

/** Búsqueda de personas para el selector de jefe (RLS limita a las visibles). */
export async function searchPeople(q: string, companyId?: string) {
  const supabase = await createClient();
  let query = supabase.from("profiles").select("id, full_name, employee_number, company_id").neq("status", "deleted").limit(10).order("full_name");
  const t = norm(q).replace(/[\\%_]/g, (c) => `\\${c}`);
  if (t) query = query.ilike("search", `%${t}%`);
  if (companyId && /^[0-9a-f-]{36}$/i.test(companyId)) query = query.eq("company_id", companyId);
  const { data } = await query;
  return (data ?? []) as { id: string; full_name: string; employee_number: string | null; company_id: string }[];
}
