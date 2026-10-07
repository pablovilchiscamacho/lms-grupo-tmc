import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MyEnrollment = {
  id: string; state: string; progress_status: string; result: string; progress_pct: number; due_at: string | null; final_score: number | null; valid_until: string | null;
  requirement: string; started_at: string | null; content_completed_at: string | null; total_seconds: number; assigned_at: string;
  course: { id: string; code: string; title: string; description: string | null; estimated_minutes: number | null; status: string } | null;
};

export async function myEnrollments() {
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getClaims();
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, state, progress_status, result, progress_pct, final_score, valid_until, due_at, requirement, started_at, content_completed_at, total_seconds, assigned_at, course:course_id(id, code, title, description, estimated_minutes, status)")
    .eq("user_id", me?.claims?.sub ?? "")
    .eq("state", "active")
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as MyEnrollment[];
  const prio = { mandatory: 0, recommended: 1, optional: 2 } as Record<string, number>;
  return rows.sort((a, b) => (prio[a.requirement] ?? 3) - (prio[b.requirement] ?? 3));
}

type FileInfo = { id: string; original_name: string; extension: string; mime_type: string; page_count: number | null; media_duration_s: number | null; size_bytes: number };
export type PlayerContent = { id: string; type: string; body_html: string | null; url: string | null; file: FileInfo | null; pdf: FileInfo | null };
export type PlayerLesson = {
  id: string; title: string; completion_rule: string; min_seconds: number | null; min_video_pct: number; is_required: boolean;
  contents: PlayerContent[];
  status: "not_started" | "viewed" | "completed"; locked: boolean; seconds: number; video_pct: number; pages: number; resume: Record<string, unknown>;
};
export type PlayerModule = { id: string; title: string; lessons: PlayerLesson[] };
export type PlayerExam = { id: string; title: string; locked: boolean; passed: boolean; pending: boolean; used: number; can_retry: boolean };
export type Player = {
  enrollment: MyEnrollment; versionId: string; sequential: boolean; modules: PlayerModule[]; order: string[]; exams: PlayerExam[];
};

const FILE_COLS = "id, original_name, extension, mime_type, page_count, media_duration_s, size_bytes";

/** Todo lo que necesita el visor del curso: estructura, avance por lección y bloqueos (misma regla que el servidor). */
export async function getPlayer(enrollmentId: string): Promise<Player | null> {
  if (!/^[0-9a-f-]{36}$/i.test(enrollmentId)) return null;
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getClaims();
  const { data: e } = await supabase
    .from("enrollments")
    .select("id, state, progress_status, result, progress_pct, final_score, valid_until, due_at, requirement, started_at, content_completed_at, total_seconds, assigned_at, course_version_id, course:course_id(id, code, title, description, estimated_minutes, status, current_version_id)")
    .eq("id", enrollmentId).eq("user_id", me?.claims?.sub ?? "").maybeSingle();
  if (!e) return null;
  const enrollment = e as unknown as MyEnrollment & { course_version_id: string | null; course: { current_version_id: string | null } };
  const versionId = enrollment.course_version_id ?? enrollment.course?.current_version_id;
  if (!versionId) return null;

  const [{ data: version }, { data: mods, error }, { data: progress }, { data: exams }] = await Promise.all([
    supabase.from("course_versions").select("sequential").eq("id", versionId).single(),
    supabase.from("course_modules")
      .select(`id, title, position, is_required, lessons(id, title, position, is_required, completion_rule, min_seconds, min_video_pct,
        contents:lesson_contents(id, position, type, body_html, url, file:file_id(${FILE_COLS}), pdf:pdf_file_id(${FILE_COLS})))`)
      .eq("course_version_id", versionId).order("position"),
    supabase.from("lesson_progress").select("lesson_id, status, seconds_spent, video_max_pct, pages_viewed, resume_state").eq("enrollment_id", enrollmentId),
    supabase.rpc("my_course_exams", { p_enrollment: enrollmentId }),
  ]);
  if (error) throw error;
  const prog = new Map((progress ?? []).map((p) => [p.lesson_id as string, p]));
  const sequential = !!version?.sequential;
  let blocked = false;
  const order: string[] = [];
  type RawLesson = Omit<PlayerLesson, "status" | "locked" | "seconds" | "video_pct" | "pages" | "resume"> & { position: number; contents: (PlayerContent & { position: number })[] };
  const modules: PlayerModule[] = ((mods ?? []) as unknown as { id: string; title: string; is_required: boolean; lessons: RawLesson[] }[]).map((m) => ({
    id: m.id,
    title: m.title,
    lessons: [...m.lessons].sort((a, b) => a.position - b.position).map((l) => {
      const p = prog.get(l.id);
      const status = (p?.status ?? "not_started") as PlayerLesson["status"];
      const lesson: PlayerLesson = {
        ...l, contents: [...l.contents].sort((a, b) => a.position - b.position),
        is_required: l.is_required && m.is_required, status, locked: sequential && blocked,
        seconds: p?.seconds_spent ?? 0, video_pct: Number(p?.video_max_pct ?? 0), pages: (p?.pages_viewed as number[] | undefined)?.length ?? 0,
        resume: (p?.resume_state as Record<string, unknown>) ?? {},
      };
      if (lesson.is_required && status !== "completed") blocked = true;
      order.push(l.id);
      return lesson;
    }),
  }));
  return { enrollment, versionId, sequential, modules, order, exams: ((exams ?? []) as PlayerExam[]) };
}
