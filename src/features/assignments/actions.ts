"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, type ActionResult } from "@/lib/action";

const optUuid = z.string().uuid().nullable().optional();
const assignmentSchema = z.object({
  course_id: z.string().uuid(),
  mode: z.enum(["direct", "rule"]),
  user_ids: z.array(z.string().uuid()).max(2000).optional(),
  company_id: optUuid, branch_id: optUuid, department_id: optUuid, position_id: optUuid, user_group_id: optUuid,
  include_future_users: z.boolean().optional(),
  requirement: z.enum(["mandatory", "recommended", "optional"]).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  due_in_days: z.number().int().min(1).max(3650).nullable().optional(),
  allow_late_access: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export type AssignmentInput = z.infer<typeof assignmentSchema>;

export async function previewAssignment(a: AssignmentInput): Promise<ActionResult<{ matching: number; already: number; new: number }>> {
  return safe(async () => {
    const v = assignmentSchema.parse(a);
    const supabase = await createClient();
    return { ok: true, data: must(await supabase.rpc("preview_assignment", { p: v })) as { matching: number; already: number; new: number } };
  });
}

export async function createAssignment(a: AssignmentInput): Promise<ActionResult> {
  let id = "";
  const r = await safe(async () => {
    const v = assignmentSchema.parse(a);
    const supabase = await createClient();
    id = (must(await supabase.rpc("create_assignment", { p: v })) as { assignment_id: string }).assignment_id;
  });
  if (!r.ok) return r;
  revalidatePath("/admin/asignaciones");
  redirect(`/admin/asignaciones/${id}?creada=1`);
}

export async function setAssignmentActive(id: string, active: boolean): Promise<ActionResult> {
  return safe(async () => {
    const supabase = await createClient();
    must(await supabase.rpc("set_assignment_active", { p_id: z.string().uuid().parse(id), p_active: active }));
    revalidatePath(`/admin/asignaciones/${id}`);
  });
}

const exceptionSchema = z.object({
  type: z.enum(["due_extension", "extra_attempts", "late_access", "reassign", "cancel"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  exam_id: z.string().uuid().nullable().optional(),
  attempts: z.number().int().min(1).max(10).optional(),
  reason: z.string().trim().min(3, "Escribe el motivo").max(500),
});

export async function adjustEnrollment(enrollmentId: string, input: z.infer<typeof exceptionSchema>, revalidate: string): Promise<ActionResult> {
  return safe(async () => {
    z.string().uuid().parse(enrollmentId);
    const v = exceptionSchema.parse(input);
    const supabase = await createClient();
    if (v.type === "cancel") must(await supabase.rpc("cancel_enrollment", { p_enrollment: enrollmentId, p_reason: v.reason }));
    else must(await supabase.rpc("grant_exception", { p_enrollment: enrollmentId, p_type: v.type, p: { date: v.date, exam_id: v.exam_id, attempts: v.attempts }, p_reason: v.reason }));
    if (revalidate.startsWith("/")) revalidatePath(revalidate);
    return { ok: true, message: "Listo." };
  });
}

export async function markNotificationsRead(ids?: string[]) {
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { p_ids: ids?.length ? ids : null });
  revalidatePath("/notificaciones");
}
