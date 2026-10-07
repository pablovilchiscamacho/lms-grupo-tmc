import type ExcelJS from "exceljs";
import { norm } from "@/lib/format";
import { validateQuestion, type QuestionInput, type QuestionType } from "./types";

const TYPE_BY_NAME: Record<string, QuestionType> = {
  "opcion multiple": "single_choice", "opcion unica": "single_choice", "una correcta": "single_choice",
  "seleccion multiple": "multiple_choice", "varias correctas": "multiple_choice",
  "verdadero/falso": "true_false", "verdadero falso": "true_false", "v/f": "true_false",
  "respuesta corta": "short_text", "corta": "short_text", "abierta": "open_text", "respuesta abierta": "open_text",
  ordenar: "ordering", relacionar: "matching", escala: "scale",
};
const DIFF: Record<string, "easy" | "medium" | "hard"> = { facil: "easy", medio: "medium", media: "medium", dificil: "hard" };

export type ImportedQuestion = { row: number; question: QuestionInput | null; error: string | null; preview: string };

export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return String(v.result ?? "");
    if ("text" in v) return String(v.text);
  }
  return String(v);
}

/** Lee la plantilla: Tipo | Pregunta | Opción A..F | Correcta | Puntos | Dificultad | Tema | Explicación */
export function parseQuestionRows(grid: string[][]): ImportedQuestion[] {
  const head = grid[0].map((h) => norm(h));
  const col = (name: string) => head.findIndex((h) => h === name || h.startsWith(name));
  const ci = { tipo: col("tipo"), pregunta: col("pregunta"), correcta: col("correcta"), puntos: col("puntos"), dificultad: col("dificultad"), tema: col("tema"), explicacion: col("explicacion") };
  if (ci.tipo < 0 || ci.pregunta < 0) throw new Error("No encontramos las columnas Tipo y Pregunta. Usa la plantilla.");
  const optCols = head.map((h, i) => (/^opcion [a-f]$/.test(h) ? i : -1)).filter((i) => i >= 0);
  return grid.slice(1).map((r, idx) => {
    const g = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const row = idx + 2;
    if (!g(ci.tipo) && !g(ci.pregunta)) return null;
    const type = TYPE_BY_NAME[norm(g(ci.tipo))];
    const prompt = g(ci.pregunta);
    if (!type) return { row, question: null, error: `Tipo «${g(ci.tipo)}» no reconocido.`, preview: prompt };
    const raw = optCols.map((i) => g(i)).filter(Boolean);
    const correct = g(ci.correcta);
    const letters = new Set(correct.toUpperCase().split(/[,;\s]+/).filter((x) => /^[A-F]$/.test(x)));
    const q: QuestionInput = {
      type, prompt, source: "import",
      default_points: Number(g(ci.puntos)) > 0 ? Number(g(ci.puntos)) : 10,
      difficulty: DIFF[norm(g(ci.dificultad))] ?? "medium",
      topic: g(ci.tema) || null, explanation: g(ci.explicacion) || null,
    };
    if (type === "single_choice" || type === "multiple_choice") {
      q.options = raw.map((t, i) => ({ text: t, is_correct: letters.has(String.fromCharCode(65 + i)) }));
      if (type === "multiple_choice") q.scoring = "partial";
    } else if (type === "true_false") {
      const c = norm(correct);
      q.tf_answer = c.startsWith("v") ? true : c.startsWith("f") ? false : (undefined as unknown as boolean);
    } else if (type === "short_text") {
      q.config = { accepted: correct.split("|").map((x) => x.trim()).filter(Boolean) };
    } else if (type === "ordering") {
      q.options = raw.map((t) => ({ text: t }));
    } else if (type === "matching") {
      q.options = raw.map((t) => { const [a, ...b] = t.split("="); return { text: (a ?? "").trim(), match_target: b.join("=").trim() }; });
    } else if (type === "scale") {
      q.config = { min: 1, max: 5 };
    }
    const error = validateQuestion(q);
    return { row, question: error ? null : q, error, preview: prompt };
  }).filter(Boolean) as ImportedQuestion[];
}

