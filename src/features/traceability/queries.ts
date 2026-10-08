import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AuditEntry } from "@/components/audit-list";

export type VersionTrace = {
  id: string; number: number; status: string; change_summary: string | null; requires_retraining: boolean; passing_score: number;
  created_at: string; created_by: string | null; published_at: string | null; published_by: string | null; retired_at: string | null;
  took: number; passed: number;
};
export type CourseTrace = { course: { code: string; title: string; created_at: string; created_by: string | null }; versions: VersionTrace[] };

export async function courseVersionsTrace(courseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("course_versions_trace", { p_course: courseId });
  if (error) throw error;
  return data as CourseTrace;
}

export async function courseHistory(courseId: string, limit = 150) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("course_history", { p_course: courseId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}

export type QuestionTrace = {
  position: number; points: number;
  snapshot: { type: string; prompt: string; options?: { id: string; text: string }[]; targets?: { id: string; text: string }[]; config?: Record<string, unknown> };
  key: unknown; response: unknown; auto_points: number | null; final_points: number | null; is_correct: boolean | null; needs_manual: boolean;
  graded_at: string | null; graded_by: string | null;
  grades: { grader: string; score_pct: number; points: number; feedback: string | null; is_override: boolean; created_at: string }[];
};
export type AttemptTrace = {
  id: string; exam: string; number: number; status: string; started_at: string; submitted_at: string | null; submitted_by: string | null;
  duration_seconds: number | null; score_pct: number | null; passed: boolean | null; max_points: number; score_points: number; graded_at: string | null;
  void_reason: string | null; voided_by: string | null; client_ip: string | null; events: { type: string; at: string }[]; questions: QuestionTrace[];
};
export type EnrollmentTrace = {
  person: { id: string; full_name: string; employee_number: string | null; company: string; department: string | null; position: string | null };
  course: { id: string; code: string; title: string; created_at: string; created_by: string | null; last_change_at: string | null };
  version: { number: number; status: string; published_at: string | null; published_by: string | null; change_summary: string | null; passing_score: number; min_completion_pct: number } | null;
  enrollment: {
    id: string; cycle: number; state: string; requirement: string; progress_status: string; result: string; progress_pct: number; final_score: number | null;
    assigned_at: string; due_at: string | null; started_at: string | null; content_completed_at: string | null; passed_at: string | null; failed_at: string | null;
    valid_until: string | null; total_seconds: number; cancelled_at: string | null; cancel_reason: string | null; assigned_by: string | null; assignment_mode: string | null;
  };
  exceptions: { type: string; reason: string; value: Record<string, unknown>; granted_by: string | null; created_at: string }[];
  lessons: { title: string; status: string; first_viewed_at: string | null; completed_at: string | null; seconds: number; required: boolean }[];
  attempts: AttemptTrace[];
  certificate: { number: string; verification_code: string; issued_at: string; expires_at: string | null; score: number | null; status: string;
    pdf_sha256: string | null; revoked_at: string | null; revoked_reason: string | null; revoked_by: string | null } | null;
  includes_keys: boolean; generated_at: string;
};

export async function enrollmentTrace(enrollmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enrollment_trace", { p_enrollment: enrollmentId });
  if (error) throw error;
  return data as EnrollmentTrace;
}

export type HistoryRow = {
  id: string; course: string; code: string; version: number | null; cycle: number; state: string; progress_status: string; result: string;
  progress_pct: number; final_score: number | null; assigned_at: string; due_at: string | null; started_at: string | null; finished_at: string | null;
  attempts: number; certificate_id: string | null;
};

export async function myHistory() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_history");
  if (error) throw error;
  return (data ?? []) as HistoryRow[];
}
