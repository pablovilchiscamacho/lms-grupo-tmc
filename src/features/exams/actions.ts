"use server";
import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, mustData, safe, UserError, type ActionResult } from "@/lib/action";
import { toFriendlyError } from "@/lib/errors";
import { norm } from "@/lib/format";
import { validateQuestion, type QuestionInput } from "./types";
import { cellText, parseQuestionRows, type ImportedQuestion } from "./import-parse";
export type { ImportedQuestion };

const uuid = z.string().uuid();

async function revalidateExam(supabase: Awaited<ReturnType<typeof createClient>>, examId: string) {
  const { data } = await supabase.from("exams").select("course_versions(course_id)").eq("id", examId).maybeSingle();
  const courseId = (data?.course_versions as unknown as { course_id: string } | null)?.course_id;
  if (courseId) revalidatePath(`/admin/cursos/${courseId}`);
}

export async function createExam(courseId: string, versionId: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(versionId);
    const supabase = await createClient();
    const { data: def } = await supabase.from("settings").select("value").eq("key", "defaults.exams").is("company_id", null).maybeSingle();
    const d = (def?.value ?? {}) as { passing_score?: number; max_attempts?: number; time_limit_minutes?: number };
    const { count } = await supabase.from("exams").select("id", { count: "exact", head: true }).eq("course_version_id", versionId);
    must(await supabase.from("exams").insert({
      course_version_id: versionId, title: count ? `Examen ${count + 1}` : "Examen final", position: (count ?? 0) + 1,
      passing_score: d.passing_score ?? 80, max_attempts: d.max_attempts ?? 3, time_limit_minutes: d.time_limit_minutes ?? 30,
    }));
    revalidatePath(`/admin/cursos/${courseId}`);
  });
}

const settingsSchema = z.object({
  title: z.string().trim().min(2).max(160),
  instructions: z.string().trim().max(4000).nullable(),
  time_limit_minutes: z.number().int().min(1).max(600).nullable(),
  max_attempts: z.number().int().min(1).max(50).nullable(),
  passing_score: z.number().min(0).max(100),
  scoring_policy: z.enum(["best", "last", "average"]),
  shuffle_questions: z.boolean(), shuffle_options: z.boolean(),
  results_visibility: z.enum(["immediate", "after_review", "hidden"]),
  allow_review: z.boolean(), show_correct_answers: z.boolean(), requires_content_complete: z.boolean(),
  cooldown_minutes: z.number().int().min(1).max(10080).nullable(),
  is_active: z.boolean(),
}).partial();

export async function updateExam(examId: string, patch: z.infer<typeof settingsSchema>): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(examId);
    const v = settingsSchema.parse(patch);
    const supabase = await createClient();
    const r = mustData(await supabase.from("exams").update(v).eq("id", examId).select("id"));
    if (!r.length) throw new UserError("No tienes permiso para editar este examen.", "FORBIDDEN");
    await revalidateExam(supabase, examId);
    return { ok: true, message: "Examen guardado." };
  });
}

export async function deleteExam(examId: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(examId);
    const supabase = await createClient();
    await revalidateExam(supabase, examId);
    must(await supabase.from("exams").delete().eq("id", examId));
  });
}

/** Guarda una pregunta (nueva o editada) y, si se indica, la agrega al examen. */
export async function saveQuestion(q: QuestionInput, examId?: string | null): Promise<ActionResult<{ id: string }>> {
  return safe(async () => {
    const err = validateQuestion(q);
    if (err) throw new UserError(err, "VALIDATION");
    const supabase = await createClient();
    const id = must(await supabase.rpc("save_question", { p: q })) as string;
    if (examId) {
      uuid.parse(examId);
      const exists = await supabase.from("exam_items").select("id").eq("exam_id", examId).eq("question_id", id).maybeSingle();
      if (!exists.data) {
        const { data: last } = await supabase.from("exam_items").select("position").eq("exam_id", examId).order("position", { ascending: false }).limit(1).maybeSingle();
        must(await supabase.from("exam_items").insert({ exam_id: examId, question_id: id, position: (last?.position ?? 0) + 1 }));
      }
      await revalidateExam(supabase, examId);
    }
    revalidatePath("/admin/banco-preguntas");
    return { ok: true, data: { id } };
  });
}

export async function deleteQuestion(id: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(id);
    const supabase = await createClient();
    must(await supabase.rpc("delete_question", { p_id: id }));
    revalidatePath("/admin/banco-preguntas");
  });
}

export async function addItems(examId: string, questionIds: string[]): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(examId); z.array(uuid).min(1).max(200).parse(questionIds);
    const supabase = await createClient();
    const { data: existing } = await supabase.from("exam_items").select("question_id, position").eq("exam_id", examId);
    const have = new Set((existing ?? []).map((r) => r.question_id));
    let pos = Math.max(0, ...(existing ?? []).map((r) => r.position));
    const rows = questionIds.filter((q) => !have.has(q)).map((q) => ({ exam_id: examId, question_id: q, position: ++pos }));
    if (rows.length) must(await supabase.from("exam_items").insert(rows));
    await revalidateExam(supabase, examId);
  });
}

export async function updateItem(examId: string, itemId: string, patch: { points?: number | null; move?: "up" | "down" }): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(itemId);
    const supabase = await createClient();
    if (patch.move) {
      const { data: items } = await supabase.from("exam_items").select("id, position").eq("exam_id", examId).order("position");
      const list = items ?? [];
      const i = list.findIndex((x) => x.id === itemId);
      const j = patch.move === "up" ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < list.length) {
        must(await supabase.from("exam_items").update({ position: list[j].position }).eq("id", list[i].id));
        must(await supabase.from("exam_items").update({ position: list[i].position }).eq("id", list[j].id));
      }
    }
    if (patch.points !== undefined) {
      const pts = patch.points === null ? null : z.number().min(0).max(1000).parse(patch.points);
      must(await supabase.from("exam_items").update({ points: pts }).eq("id", itemId));
    }
    await revalidateExam(supabase, examId);
  });
}

export async function removeItem(examId: string, itemId: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(itemId);
    const supabase = await createClient();
    must(await supabase.from("exam_items").delete().eq("id", itemId));
    await revalidateExam(supabase, examId);
  });
}

const poolSchema = z.object({
  category_id: z.string().uuid().nullable(), difficulty: z.enum(["easy", "medium", "hard"]).nullable(),
  topic: z.string().trim().max(120).nullable(), draw_count: z.number().int().min(1).max(200), points_each: z.number().min(0).max(1000).nullable(),
});
export async function addPool(examId: string, p: z.infer<typeof poolSchema>): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(examId);
    const v = poolSchema.parse(p);
    const supabase = await createClient();
    must(await supabase.from("exam_pools").insert({ ...v, exam_id: examId }));
    await revalidateExam(supabase, examId);
  });
}
export async function removePool(examId: string, poolId: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(poolId);
    const supabase = await createClient();
    must(await supabase.from("exam_pools").delete().eq("id", poolId));
    await revalidateExam(supabase, examId);
  });
}

export async function createQuestionCategory(name: string): Promise<ActionResult<{ id: string }>> {
  return safe(async () => {
    const n = z.string().trim().min(2).max(80).parse(name);
    const slug = norm(n).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "categoria";
    const supabase = await createClient();
    const found = await supabase.from("categories").select("id").eq("kind", "question").eq("slug", slug).maybeSingle();
    if (found.data) return { ok: true, data: { id: found.data.id as string } };
    const r = mustData(await supabase.from("categories").insert({ kind: "question", name: n, slug }).select("id").single());
    return { ok: true, data: { id: r.id as string } };
  });
}

// ─────────────────────────────── Importación desde Excel (§11.3) ───────────────────────────────

export async function previewQuestionImport(_: unknown, fd: FormData): Promise<ActionResult<ImportedQuestion[]>> {
  return safe(async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Elige un archivo.");
    if (file.size > 5 * 1024 * 1024) throw new UserError("El archivo pesa más de 5 MB.");
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new UserError("Sube el archivo de Excel (.xlsx) de la plantilla.");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(r.getCell(c).value));
      grid.push(vals);
    });
    if (grid.length < 2) throw new UserError("El archivo no tiene preguntas.");
    const rows = parseQuestionRows(grid);
    if (rows.length > 500) throw new UserError("Máximo 500 preguntas por archivo.");
    return { ok: true, data: rows };
  });
}

/** Crea las preguntas válidas en el banco (categoría opcional) y, si se indica, las agrega al examen. */
export async function commitQuestionImport(questions: QuestionInput[], examId: string | null, categoryName: string | null): Promise<ActionResult<{ created: number; failed: { prompt: string; error: string }[] }>> {
  return safe(async () => {
    if (questions.length > 500) throw new UserError("Máximo 500 preguntas por archivo.");
    const supabase = await createClient();
    let category: string | null = null;
    if (categoryName?.trim()) {
      const c = await createQuestionCategory(categoryName);
      if (c.ok) category = c.data!.id;
    }
    const ids: string[] = [];
    const failed: { prompt: string; error: string }[] = [];
    for (const q of questions) {
      const err = validateQuestion(q);
      if (err) { failed.push({ prompt: q.prompt, error: err }); continue; }
      const r = await supabase.rpc("save_question", { p: { ...q, id: null, category_id: category, source: "import" } });
      if (r.error) failed.push({ prompt: q.prompt, error: toFriendlyError(r.error).message });
      else ids.push(r.data as string);
    }
    if (examId && ids.length) {
      const added = await addItems(examId, ids);
      if (!added.ok) throw new UserError(added.error.message);
    }
    revalidatePath("/admin/banco-preguntas");
    return { ok: true, data: { created: ids.length, failed } };
  });
}

/** Buscador del banco para "Agregar del banco" (RLS limita al alcance de quien busca). */
export async function searchBank(text: string, type: string | null): Promise<ActionResult<{ id: string; type: string; prompt: string; difficulty: string; topic: string | null; default_points: number }[]>> {
  return safe(async () => {
    const supabase = await createClient();
    let query = supabase.from("questions").select("id, type, prompt, difficulty, topic, default_points").eq("is_current", true).is("deleted_at", null).limit(50).order("created_at", { ascending: false });
    const t = norm(text ?? "").replace(/[\\%_]/g, (c) => `\\${c}`);
    if (t) query = query.ilike("search", `%${t}%`);
    if (type) query = query.eq("type", type);
    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, data: (data ?? []) as { id: string; type: string; prompt: string; difficulty: string; topic: string | null; default_points: number }[] };
  });
}
