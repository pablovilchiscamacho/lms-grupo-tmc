import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MyExam = {
  id: string; title: string; instructions: string | null; is_required: boolean; time_limit_minutes: number | null; max_attempts: number | null;
  passing_score: number; scoring_policy: string; is_active: boolean; cooldown_minutes: number | null; question_count: number; locked: boolean;
  used: number; passed: boolean; pending: boolean; can_retry: boolean; score: number | null; open_attempt: string | null;
  attempts: { id: string; number: number; status: string; submitted_at: string | null; score_pct: number | null; passed: boolean | null }[];
};

export async function myCourseExams(enrollmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_course_exams", { p_enrollment: enrollmentId });
  if (error) return [] as MyExam[];
  return (data ?? []) as MyExam[];
}

export type AttemptResult = {
  attempt_id: string; attempt_number: number; status: string; submitted_by: string | null; submitted_at: string | null; duration_seconds: number | null;
  exam_title: string; passing_score: number; visible: boolean; score_pct: number | null; passed: boolean | null;
  review: { position: number; prompt: string; type: string; snapshot: import("./actions").Snapshot; response: Record<string, unknown> | null; points: number;
    earned: number | null; correct: boolean | null; pending: boolean; feedback: string | null; answer_key: Record<string, unknown> | null }[] | null;
};

export async function myAttemptResult(attemptId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_attempt_result", { p_attempt: attemptId });
  if (error) return null;
  return data as AttemptResult;
}
