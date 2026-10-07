import "server-only";
import { createClient } from "@/lib/supabase/server";
import { norm } from "@/lib/format";
import type { ExamRow, QuestionRow } from "./types";

const Q_COLS = "id, type, prompt, explanation, topic, difficulty, default_points, scoring, config, revision, is_locked, category_id, created_at, options:question_options(id, position, text, is_correct, match_target)";

const sortOptions = (q: QuestionRow) => { q.options?.sort((a, b) => a.position - b.position); return q; };

export async function getExams(versionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exams")
    .select(`id, title, instructions, is_required, time_limit_minutes, max_attempts, passing_score, scoring_policy, shuffle_questions, shuffle_options,
      results_visibility, allow_review, show_correct_answers, requires_content_complete, cooldown_minutes, is_active, position,
      items:exam_items(id, position, points, question:question_id(${Q_COLS})),
      pools:exam_pools(id, category_id, difficulty, topic, draw_count, points_each)`)
    .eq("course_version_id", versionId)
    .order("position");
  if (error) throw error;
  const exams = (data ?? []) as unknown as ExamRow[];
  for (const e of exams) { e.items.sort((a, b) => a.position - b.position); e.items.forEach((i) => sortOptions(i.question)); }
  return exams;
}

export async function listQuestions(f: { q?: string; type?: string; difficulty?: string; category?: string; page?: number }) {
  const supabase = await createClient();
  const page = Math.max(1, f.page ?? 1);
  let query = supabase.from("questions").select(Q_COLS, { count: "exact" }).eq("is_current", true).is("deleted_at", null);
  if (f.q?.trim()) query = query.ilike("search", `%${norm(f.q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (f.type) query = query.eq("type", f.type);
  if (f.difficulty) query = query.eq("difficulty", f.difficulty);
  if (f.category && /^[0-9a-f-]{36}$/i.test(f.category)) query = query.eq("category_id", f.category);
  const { data, count, error } = await query.order("created_at", { ascending: false }).range((page - 1) * 25, page * 25 - 1);
  if (error) throw error;
  return { rows: ((data ?? []) as unknown as QuestionRow[]).map(sortOptions), total: count ?? 0, page };
}

export async function listQuestionCategories() {
  const supabase = await createClient();
  const { data } = await supabase.from("categories").select("id, name").eq("kind", "question").order("name");
  return (data ?? []) as { id: string; name: string }[];
}
