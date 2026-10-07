"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, mustData, safe, UserError, type ActionResult } from "@/lib/action";

const uuid = z.string().uuid();
const optUuid = z.string().trim().transform((v) => (v === "" ? null : v)).nullable().refine((v) => v == null || uuid.safeParse(v).success, "Valor inválido");
const optInt = (min: number, max: number) =>
  z.string().trim().transform((v) => (v === "" ? null : Number(v))).nullable()
    .refine((v) => v == null || (Number.isInteger(v) && v >= min && v <= max), `Entre ${min} y ${max}`);

const courseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, "2 a 20 caracteres: letras, números, - o _"),
  title: z.string().trim().min(3, "Mínimo 3 caracteres").max(160),
  description: z.string().trim().max(4000).transform((v) => (v === "" ? null : v)).nullable(),
  owner_company_id: optUuid,
  default_requirement: z.enum(["mandatory", "recommended", "optional"]),
  estimated_minutes: optInt(1, 10000),
  issues_certificate: z.boolean(),
  validity_months: optInt(1, 120),
});

function courseFromForm(fd: FormData) {
  const s = (k: string) => (fd.get(k) ?? "").toString();
  return courseSchema.parse({
    code: s("code"), title: s("title"), description: s("description"), owner_company_id: s("owner_company_id"),
    default_requirement: s("default_requirement") || "mandatory", estimated_minutes: s("estimated_minutes"),
    issues_certificate: fd.get("issues_certificate") === "on", validity_months: s("validity_months"),
  });
}

/** Paso 1 del asistente: crea el curso (versión 1 en borrador) y lleva al armado del contenido. */
export async function createCourse(_: unknown, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safe(async () => {
    const v = courseFromForm(fd);
    const supabase = await createClient();
    id = must(await supabase.rpc("create_course", { p: v })) as string;
  });
  if (!r.ok) return r;
  redirect(`/admin/cursos/${id}?paso=contenido`);
}

export async function updateCourse(courseId: string, _: unknown, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(courseId);
    const { code: _code, owner_company_id: _owner, ...rest } = courseFromForm(fd);
    void _code; void _owner;
    const supabase = await createClient();
    const res = mustData(await supabase.from("courses").update(rest).eq("id", courseId).select("id"));
    if (!res.length) throw new UserError("No tienes permiso para editar este curso.", "FORBIDDEN");
    revalidatePath(`/admin/cursos/${courseId}`);
    return { ok: true, message: "Datos guardados." };
  });
}

const versionSchema = z.object({
  passing_score: z.number().min(0).max(100),
  min_completion_pct: z.number().min(0).max(100),
  sequential: z.boolean(),
});

export async function updateVersionSettings(courseId: string, versionId: string, v: z.infer<typeof versionSchema>): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(versionId);
    const data = versionSchema.parse(v);
    const supabase = await createClient();
    const res = mustData(await supabase.from("course_versions").update(data).eq("id", versionId).select("id"));
    if (!res.length) throw new UserError("No tienes permiso para editar este curso.", "FORBIDDEN");
    revalidatePath(`/admin/cursos/${courseId}`);
    return { ok: true, message: "Reglas guardadas." };
  });
}

/** Problemas que impiden publicar (lista vacía = listo). */
export async function getPublishIssues(versionId: string): Promise<string[]> {
  uuid.parse(versionId);
  const supabase = await createClient();
  const { data } = await supabase.rpc("version_publish_issues", { p_version: versionId });
  return (data as string[] | null) ?? [];
}

export async function publishCourse(courseId: string, summary: string, retraining: boolean): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(courseId);
    const supabase = await createClient();
    must(await supabase.rpc("publish_course_version", {
      p_course: courseId, p_change_summary: z.string().trim().max(2000).parse(summary), p_requires_retraining: retraining,
    }));
    revalidatePath(`/admin/cursos/${courseId}`);
    revalidatePath("/admin/cursos");
    return { ok: true, message: "Curso publicado." };
  });
}

/** Editar un curso publicado: crea (o reutiliza) la versión en borrador. */
export async function startNewVersion(courseId: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(courseId);
    const supabase = await createClient();
    must(await supabase.rpc("create_draft_version", { p_course: courseId }));
    revalidatePath(`/admin/cursos/${courseId}`);
  });
}

export async function setCourseStatus(courseId: string, to: "review" | "draft" | "suspended" | "published" | "archived", note?: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(courseId);
    const supabase = await createClient();
    must(await supabase.rpc("set_course_status", { p_course: courseId, p_to: to, p_note: note ?? null }));
    revalidatePath(`/admin/cursos/${courseId}`);
    revalidatePath("/admin/cursos");
  });
}

export async function duplicateCourse(courseId: string, _: unknown, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await safe(async () => {
    uuid.parse(courseId);
    const code = courseSchema.shape.code.parse(fd.get("code") ?? "");
    const title = courseSchema.shape.title.parse(fd.get("title") ?? "");
    const supabase = await createClient();
    id = must(await supabase.rpc("duplicate_course", { p_course: courseId, p_code: code, p_title: title })) as string;
  });
  if (!r.ok) return r;
  redirect(`/admin/cursos/${id}?paso=contenido`);
}

export async function deleteCourse(courseId: string): Promise<ActionResult> {
  const r = await safe(async () => {
    uuid.parse(courseId);
    const supabase = await createClient();
    must(await supabase.rpc("delete_course", { p_course: courseId }));
  });
  if (!r.ok) return r;
  redirect("/admin/cursos?borrado=1");
}

// ─────────────────────────────── Asignación (Fase 2: directa) ───────────────────────────────

const audienceSchema = z.object({
  company: optUuid, branch: optUuid, department: optUuid, position: optUuid,
  userIds: z.array(uuid).max(2000).optional(),
});
export type Audience = z.input<typeof audienceSchema>;

/** Personas activas que coinciden con el filtro, dentro del alcance del administrador (RLS). */
async function resolveAudience(a: Audience) {
  const v = audienceSchema.parse(a);
  const supabase = await createClient();
  if (v.userIds?.length) return v.userIds;
  if (!v.company && !v.branch && !v.department && !v.position) throw new UserError("Elige al menos una empresa, sucursal, departamento o puesto.");
  let q = supabase.from("profiles").select("id").eq("status", "active").limit(2000);
  if (v.company) q = q.eq("company_id", v.company);
  if (v.branch) q = q.eq("branch_id", v.branch);
  if (v.department) q = q.eq("department_id", v.department);
  if (v.position) q = q.eq("position_id", v.position);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

export async function previewAudience(a: Audience): Promise<ActionResult<{ count: number }>> {
  return safe(async () => ({ ok: true, data: { count: (await resolveAudience(a)).length } }));
}

export async function enrollAudience(courseId: string, a: Audience, dueDate: string | null, requirement: string | null): Promise<ActionResult<{ created: number; skipped: number; forbidden: number }>> {
  return safe(async () => {
    uuid.parse(courseId);
    const ids = await resolveAudience(a);
    if (!ids.length) throw new UserError("No hay personas activas con ese filtro.");
    const due = dueDate ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(dueDate) : null;
    const supabase = await createClient();
    const res = must(await supabase.rpc("admin_enroll", {
      p_course: courseId, p_user_ids: ids,
      // Fecha límite = fin del día en hora del centro de México (§16, C5)
      p_due_at: due ? new Date(`${due}T23:59:59-06:00`).toISOString() : null,
      p_requirement: requirement ? z.enum(["mandatory", "recommended", "optional"]).parse(requirement) : null,
    })) as { created: number; skipped: number; forbidden: number };
    revalidatePath(`/admin/cursos/${courseId}`);
    return { ok: true, data: res };
  });
}

export async function cancelEnrollment(courseId: string, enrollmentId: string, reason: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(enrollmentId);
    const supabase = await createClient();
    must(await supabase.rpc("cancel_enrollment", { p_enrollment: enrollmentId, p_reason: reason }));
    revalidatePath(`/admin/cursos/${courseId}`);
  });
}
