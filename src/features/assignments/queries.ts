import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AssignmentRow = {
  id: string; mode: "direct" | "rule"; include_future_users: boolean; requirement: string; due_at: string | null; due_in_days: number | null;
  is_active: boolean; created_at: string; notes: string | null;
  course: { id: string; code: string; title: string } | null;
  company: { short_name: string } | null; branch: { name: string } | null; department: { name: string } | null;
  position: { name: string } | null; group: { name: string } | null; creator: { full_name: string } | null;
  enrollments: { count: number }[];
};

const COLS = `id, mode, include_future_users, requirement, due_at, due_in_days, is_active, created_at, notes,
  course:course_id(id, code, title), company:company_id(short_name), branch:branch_id(name), department:department_id(name),
  position:position_id(name), group:user_group_id(name), creator:created_by(full_name), enrollments(count)`;

export async function listAssignments(f: { course?: string; active?: string }) {
  const supabase = await createClient();
  let q = supabase.from("assignments").select(COLS).order("created_at", { ascending: false }).limit(200);
  if (f.course && /^[0-9a-f-]{36}$/i.test(f.course)) q = q.eq("course_id", f.course);
  if (f.active === "1") q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as AssignmentRow[];
}

export async function getAssignment(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("assignments").select(COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as AssignmentRow | null;
}

export type EnrollmentRow = {
  id: string; state: string; cycle: number; progress_status: string; result: string; progress_pct: number; final_score: number | null;
  due_at: string | null; assigned_at: string; started_at: string | null; passed_at: string | null; valid_until: string | null; cancel_reason: string | null;
  course_version_id: string | null;
  user: { id: string; full_name: string; employee_number: string | null } | null;
  course: { id: string; code: string; title: string } | null;
  version: { version_number: number } | null;
};
const ENR_COLS = `id, state, cycle, progress_status, result, progress_pct, final_score, due_at, assigned_at, started_at, passed_at, valid_until, cancel_reason, course_version_id,
  user:user_id(id, full_name, employee_number), course:course_id(id, code, title), version:course_version_id(version_number)`;

export async function enrollmentsFor(filter: { assignment?: string; user?: string; course?: string }) {
  const supabase = await createClient();
  let q = supabase.from("enrollments").select(ENR_COLS).order("assigned_at", { ascending: false }).limit(1000);
  if (filter.assignment) q = q.eq("assignment_id", filter.assignment);
  if (filter.user) q = q.eq("user_id", filter.user);
  if (filter.course) q = q.eq("course_id", filter.course);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as EnrollmentRow[];
}

/** Exámenes de la versión de cada inscripción (para "dar un intento extra"). */
export async function examsByVersion(versionIds: string[]) {
  const ids = [...new Set(versionIds.filter(Boolean))];
  if (!ids.length) return {} as Record<string, { id: string; title: string }[]>;
  const supabase = await createClient();
  const { data } = await supabase.from("exams").select("id, title, course_version_id").in("course_version_id", ids);
  const out: Record<string, { id: string; title: string }[]> = {};
  for (const e of data ?? []) (out[e.course_version_id as string] ??= []).push({ id: e.id as string, title: e.title as string });
  return out;
}

export async function publishedCourses() {
  const supabase = await createClient();
  const { data } = await supabase.from("courses").select("id, code, title, status").in("status", ["published", "draft", "review"]).is("deleted_at", null).order("title");
  return (data ?? []) as { id: string; code: string; title: string; status: string }[];
}

export async function myNotifications(limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, type, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }[];
}

export async function unreadCount() {
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
}
