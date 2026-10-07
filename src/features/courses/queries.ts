import "server-only";
import { createClient } from "@/lib/supabase/server";
import { norm } from "@/lib/format";

export type CourseListRow = {
  id: string; code: string; title: string; status: string; updated_at: string; owner_company: { short_name: string } | null;
  versions: { version_number: number; status: string }[]; enrollments: { count: number }[];
};

export async function listCourses(f: { q?: string; status?: string }) {
  const supabase = await createClient();
  let query = supabase
    .from("courses")
    .select("id, code, title, status, updated_at, owner_company:owner_company_id(short_name), versions:course_versions(version_number, status), enrollments(count)")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (f.q?.trim()) query = query.ilike("search", `%${norm(f.q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (f.status && ["draft", "review", "published", "suspended", "archived"].includes(f.status)) query = query.eq("status", f.status);
  else query = query.neq("status", "archived");
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as CourseListRow[];
}

export type FileRef = {
  id: string; original_name: string; extension: string; size_bytes: number; status: string; page_count: number | null;
  media_duration_s: number | null; conversion_status: string | null; conversion_error: string | null; converted_pdf_id: string | null;
};
export type ContentRow = {
  id: string; position: number; type: string; body_html: string | null; url: string | null;
  file: FileRef | null; pdf: FileRef | null;
};
export type LessonRow = {
  id: string; title: string; position: number; is_required: boolean; completion_rule: string; min_seconds: number | null;
  min_video_pct: number; contents: ContentRow[];
};
export type ModuleRow = { id: string; title: string; position: number; is_required: boolean; lessons: LessonRow[] };
export type VersionRow = {
  id: string; version_number: number; status: string; passing_score: number; min_completion_pct: number; sequential: boolean;
  change_summary: string | null; published_at: string | null; review_notes: string | null;
};
export type CourseDetail = {
  id: string; code: string; title: string; description: string | null; status: string; owner_company_id: string | null;
  owner_department_id: string | null; default_requirement: string; estimated_minutes: number | null; issues_certificate: boolean;
  validity_months: number | null; current_version_id: string | null; created_at: string; published_at: string | null;
  versions: VersionRow[];
};

const FILE_COLS = "id, original_name, extension, size_bytes, status, page_count, media_duration_s, conversion_status, conversion_error, converted_pdf_id";

export async function getCourse(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select(`id, code, title, description, status, owner_company_id, owner_department_id, default_requirement, estimated_minutes,
      issues_certificate, validity_months, current_version_id, created_at, published_at,
      versions:course_versions(id, version_number, status, passing_score, min_completion_pct, sequential, change_summary, published_at, review_notes)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const course = data as unknown as CourseDetail;
  course.versions.sort((a, b) => b.version_number - a.version_number);
  return course;
}

/** Estructura completa de una versión (módulos → lecciones → contenidos con sus archivos). */
export async function getVersionTree(versionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("course_modules")
    .select(`id, title, position, is_required,
      lessons(id, title, position, is_required, completion_rule, min_seconds, min_video_pct,
        contents:lesson_contents(id, position, type, body_html, url, file:file_id(${FILE_COLS}), pdf:pdf_file_id(${FILE_COLS})))`)
    .eq("course_version_id", versionId)
    .order("position");
  if (error) throw error;
  const modules = (data ?? []) as unknown as ModuleRow[];
  for (const m of modules) {
    m.lessons.sort((a, b) => a.position - b.position);
    for (const l of m.lessons) l.contents.sort((a, b) => a.position - b.position);
  }
  return modules;
}

export type Participant = {
  id: string; state: string; progress_status: string; result: string; progress_pct: number; due_at: string | null;
  assigned_at: string; started_at: string | null; total_seconds: number;
  version: { version_number: number } | null; user: { id: string; full_name: string; employee_number: string | null } | null;
};

export async function listParticipants(courseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, state, progress_status, result, progress_pct, due_at, assigned_at, started_at, total_seconds, version:course_version_id(version_number), user:user_id(id, full_name, employee_number)")
    .eq("course_id", courseId)
    .order("assigned_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as Participant[];
}

export type StorageUsage = {
  used_bytes: number; files: number; quota_gb: number; warn_pct: number; by_kind: Record<string, number>;
  by_course: { course_id: string; code: string; title: string; bytes: number; files: number }[];
  largest: { id: string; name: string; bytes: number; course: string | null }[];
};

export async function getStorageUsage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("storage_usage");
  if (error) throw error;
  return data as StorageUsage;
}
