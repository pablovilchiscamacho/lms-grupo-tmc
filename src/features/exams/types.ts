export const QUESTION_TYPES = {
  single_choice: "Opción múltiple (una correcta)",
  multiple_choice: "Selección múltiple (varias correctas)",
  true_false: "Verdadero / Falso",
  short_text: "Respuesta corta",
  open_text: "Respuesta abierta (se califica a mano)",
  ordering: "Ordenar",
  matching: "Relacionar",
  scale: "Escala (opinión)",
} as const;
export type QuestionType = keyof typeof QUESTION_TYPES;
export const SHORT_TYPE: Record<QuestionType, string> = {
  single_choice: "Opción múltiple", multiple_choice: "Selección múltiple", true_false: "V/F", short_text: "Corta",
  open_text: "Abierta", ordering: "Ordenar", matching: "Relacionar", scale: "Escala",
};
export const DIFFICULTY = { easy: "Fácil", medium: "Medio", hard: "Difícil" } as const;

export type OptionInput = { text: string; is_correct?: boolean; match_target?: string | null };
export type QuestionInput = {
  id?: string | null; type: QuestionType; prompt: string; explanation?: string | null; topic?: string | null;
  difficulty?: keyof typeof DIFFICULTY; default_points?: number; scoring?: "all_or_nothing" | "partial";
  category_id?: string | null; owner_company_id?: string | null; config?: Record<string, unknown>; options?: OptionInput[];
  tf_answer?: boolean; source?: "manual" | "import";
};

export type QuestionRow = {
  id: string; type: QuestionType; prompt: string; explanation: string | null; topic: string | null; difficulty: keyof typeof DIFFICULTY;
  default_points: number; scoring: "all_or_nothing" | "partial"; config: Record<string, unknown>; revision: number; is_locked: boolean;
  category_id: string | null; created_at: string; options: { id: string; position: number; text: string; is_correct: boolean; match_target: string | null }[];
};

export type ExamRow = {
  id: string; title: string; instructions: string | null; is_required: boolean; time_limit_minutes: number | null; max_attempts: number | null;
  passing_score: number; scoring_policy: "best" | "last" | "average"; shuffle_questions: boolean; shuffle_options: boolean;
  results_visibility: "immediate" | "after_review" | "hidden"; allow_review: boolean; show_correct_answers: boolean;
  requires_content_complete: boolean; cooldown_minutes: number | null; is_active: boolean; position: number;
  items: { id: string; position: number; points: number | null; question: QuestionRow }[];
  pools: { id: string; category_id: string | null; difficulty: string | null; topic: string | null; draw_count: number; points_each: number | null }[];
};

/** Misma validación que app.validate_question (para la vista previa de importación). */
export function validateQuestion(q: QuestionInput): string | null {
  if (!q.prompt || q.prompt.trim().length < 3) return "Escribe la pregunta.";
  const opts = q.options ?? [];
  const nCorrect = opts.filter((o) => o.is_correct).length;
  if (opts.some((o) => !o.text?.trim())) return "Hay opciones vacías.";
  switch (q.type) {
    case "single_choice": return opts.length < 2 ? "Agrega al menos 2 opciones." : nCorrect !== 1 ? "Marca exactamente una respuesta correcta." : null;
    case "multiple_choice": return opts.length < 2 ? "Agrega al menos 2 opciones." : nCorrect < 1 ? "Marca al menos una respuesta correcta." : null;
    case "true_false": return typeof q.tf_answer !== "boolean" ? "Indica si es Verdadero o Falso." : null;
    case "short_text": return ((q.config?.accepted as string[]) ?? []).filter(Boolean).length ? null : "Escribe al menos una respuesta aceptada.";
    case "ordering": return opts.length < 2 ? "Agrega al menos 2 elementos para ordenar." : null;
    case "matching": return opts.length < 2 ? "Agrega al menos 2 pares para relacionar." : opts.some((o) => !o.match_target?.trim()) ? "Cada concepto necesita su pareja." : null;
    default: return null;
  }
}
