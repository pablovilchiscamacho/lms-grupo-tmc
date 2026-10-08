import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Filtros comunes de los tableros (se leen de la URL en español y viajan a las RPC en inglés). */
export type DashFilters = {
  company_id?: string; branch_id?: string; department_id?: string; position_id?: string; manager_id?: string;
  course_id?: string; from?: string; to?: string; q?: string; light?: Light | "none"; only_overdue?: boolean; only_due_week?: boolean; only_failed?: boolean;
};
export type Light = "green" | "amber" | "red";

export type Summary = {
  users: { total: number; active: number; inactive: number };
  enrollments: {
    assigned: number; completed: number; failed: number; overdue: number; pending: number; due_week: number;
    failed_people: number; overdue_people: number; people_with_courses: number;
    compliance: number | null; avg_score: number | null; pass_rate: number | null; fail_rate: number | null;
  };
  hours: { total: number; per_person: number | null };
};
export type PersonRow = {
  id: string; full_name: string; employee_number: string | null; company: string; branch: string | null; department: string | null; position: string | null;
  assigned: number; completed: number; pending: number; overdue: number; failed: number; avg_score: number | null; compliance: number | null;
};
export type GroupRow = {
  id: string | null; name: string; code: string | null; users: number; assigned: number; completed: number; pending: number;
  overdue: number; failed: number; avg_score: number | null; fail_rate: number | null; compliance: number | null;
};
export type ActivityRow = { user_id: string; full_name: string; kind: "assigned" | "completed" | "passed" | "failed"; at: string; course: string };
export type TrendRow = { month: string; date: string; assigned: number; completed: number; overdue: number; failed: number; compliance: number | null };

export const PEOPLE_PAGE = 50;
const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** URL (?empresa=…&semaforo=rojo) → filtros validados. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): DashFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const id = (k: string) => (UUID.test(s(k)) ? s(k) : undefined);
  const light = ({ verde: "green", amarillo: "amber", rojo: "red", "sin-cursos": "none" } as const)[s("semaforo") as "verde"];
  return {
    company_id: id("empresa"), branch_id: id("sucursal"), department_id: id("departamento"), position_id: id("puesto"),
    manager_id: id("jefe"), course_id: id("curso"),
    from: DATE.test(s("desde")) ? s("desde") : undefined, to: DATE.test(s("hasta")) ? s("hasta") : undefined,
    q: s("q").slice(0, 80) || undefined, light,
    only_overdue: s("estado") === "vencidos" || undefined, only_due_week: s("estado") === "por-vencer" || undefined,
    only_failed: s("estado") === "reprobados" || undefined,
  };
}

const clean = (f: DashFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ""));

export async function dashboardSummary(f: DashFilters = {}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_summary", { f: clean(f) });
  if (error) throw error;
  return data as Summary;
}

export async function dashboardPeople(f: DashFilters, sort = "compliance", page = 1, size = PEOPLE_PAGE) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_people", { f: clean(f), p_sort: sort, p_limit: size, p_offset: (page - 1) * size });
  if (error) throw error;
  return data as { total: number; rows: PersonRow[] };
}

export async function dashboardBreakdown(group: "company" | "branch" | "department" | "position" | "course", f: DashFilters = {}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_breakdown", { p_group: group, f: clean(f) });
  if (error) throw error;
  return data as GroupRow[];
}

export async function dashboardActivity(f: DashFilters = {}, limit = 10) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_activity", { f: clean(f), p_limit: limit });
  if (error) throw error;
  return data as ActivityRow[];
}

export async function dashboardTrend(f: DashFilters = {}, months = 12) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_trend", { f: clean(f), p_months: months });
  if (error) throw error;
  return data as TrendRow[];
}

/** Opciones de los filtros que no vienen de la organización: cursos y jefes visibles. */
export async function filterOptions() {
  const supabase = await createClient();
  const [courses, managers] = await Promise.all([
    supabase.from("courses").select("id, code, title").neq("status", "draft").order("title"),
    supabase.from("profiles").select("manager_id").not("manager_id", "is", null).eq("status", "active"),
  ]);
  const ids = [...new Set((managers.data ?? []).map((m) => m.manager_id as string))];
  const names = ids.length
    ? ((await supabase.from("profiles").select("id, full_name").in("id", ids).order("full_name")).data ?? [])
    : [];
  return { courses: (courses.data ?? []) as { id: string; code: string; title: string }[], managers: names as { id: string; full_name: string }[] };
}

/** Semáforo del documento maestro (§22): verde ≥ 90 %, amarillo 70–89 %, rojo < 70 %. */
export function lightOf(pct: number | null | undefined): Light | null {
  if (pct === null || pct === undefined) return null;
  return pct >= 90 ? "green" : pct >= 70 ? "amber" : "red";
}
