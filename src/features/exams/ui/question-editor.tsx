"use client";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Alert, Field } from "@/components/ui";
import { saveQuestion } from "../actions";
import { DIFFICULTY, QUESTION_TYPES, validateQuestion, type OptionInput, type QuestionInput, type QuestionRow, type QuestionType } from "../types";

const blankOptions = (t: QuestionType): OptionInput[] =>
  t === "matching" ? [{ text: "", match_target: "" }, { text: "", match_target: "" }]
    : t === "ordering" ? [{ text: "" }, { text: "" }, { text: "" }]
      : ["single_choice", "multiple_choice"].includes(t) ? [{ text: "", is_correct: true }, { text: "" }, { text: "" }, { text: "" }] : [];

export function fromRow(q: QuestionRow): QuestionInput {
  return {
    id: q.id, type: q.type, prompt: q.prompt, explanation: q.explanation, topic: q.topic, difficulty: q.difficulty,
    default_points: Number(q.default_points), scoring: q.scoring, category_id: q.category_id, config: q.config ?? {},
    options: q.options.map((o) => ({ text: o.text, is_correct: o.is_correct, match_target: o.match_target })),
    tf_answer: q.type === "true_false" ? q.options.find((o) => o.is_correct)?.text === "Verdadero" : undefined,
  };
}

/** Constructor de preguntas (§37): tipo, pregunta, respuestas, correcta, puntos y explicación. */
export function QuestionEditor({ initial, examId, categories, locked, onSaved, onCancel }: {
  initial?: QuestionInput; examId?: string | null; categories: { id: string; name: string }[]; locked?: boolean;
  onSaved: () => void; onCancel: () => void;
}) {
  const [q, setQ] = useState<QuestionInput>(initial ?? { type: "single_choice", prompt: "", default_points: 10, difficulty: "medium", options: blankOptions("single_choice"), config: {} });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<QuestionInput>) => setQ((x) => ({ ...x, ...p }));
  const opts = q.options ?? [];
  const setOpt = (i: number, p: Partial<OptionInput>) => set({ options: opts.map((o, j) => (j === i ? { ...o, ...p } : q.type === "single_choice" && p.is_correct ? { ...o, is_correct: false } : o)) });
  const move = (i: number, d: -1 | 1) => { const n = [...opts]; [n[i], n[i + d]] = [n[i + d], n[i]]; set({ options: n }); };
  const cfg = q.config ?? {};

  const changeType = (t: QuestionType) => set({ type: t, options: blankOptions(t), config: t === "scale" ? { min: 1, max: 5 } : t === "short_text" ? { accepted: [""] } : {}, tf_answer: t === "true_false" ? true : undefined, scoring: t === "multiple_choice" ? "partial" : "all_or_nothing", default_points: t === "scale" ? 0 : q.default_points || 10 });

  const save = () => start(async () => {
    const clean: QuestionInput = { ...q, config: q.type === "short_text" ? { ...cfg, accepted: ((cfg.accepted as string[]) ?? []).map((s) => s.trim()).filter(Boolean) } : cfg };
    const err = validateQuestion(clean);
    if (err) return setError(err);
    const r = await saveQuestion(clean, examId);
    if (!r.ok) return setError(r.error.message);
    onSaved();
  });

  return (
    <div className="space-y-4">
      {locked && <Alert kind="info">Esta pregunta ya se usó en un examen publicado o presentado. Al guardar se crea una <strong>revisión nueva</strong>; lo que ya se presentó no cambia.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <Field label="Tipo" htmlFor="q-type">
          <select id="q-type" className="input" value={q.type} onChange={(e) => changeType(e.target.value as QuestionType)} disabled={!!q.id}>
            {Object.entries(QUESTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Puntos" htmlFor="q-points">
          <input id="q-points" type="number" min={0} max={1000} className="input" value={q.default_points ?? 10} onChange={(e) => set({ default_points: Number(e.target.value) })} disabled={q.type === "scale" && !cfg.graded} />
        </Field>
      </div>
      <Field label="Pregunta" htmlFor="q-prompt" required>
        <textarea id="q-prompt" rows={3} className="input" value={q.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="Escribe la pregunta tal como la leerá el empleado." />
      </Field>

      {(q.type === "single_choice" || q.type === "multiple_choice") && (
        <fieldset className="space-y-2">
          <legend className="label">Respuestas — marca {q.type === "single_choice" ? "la correcta" : "todas las correctas"}</legend>
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type={q.type === "single_choice" ? "radio" : "checkbox"} name="correct" className="size-4" checked={!!o.is_correct}
                onChange={(e) => setOpt(i, { is_correct: e.target.checked })} aria-label={`Respuesta ${String.fromCharCode(65 + i)} correcta`} />
              <span className="w-5 text-xs font-semibold text-slate-400">{String.fromCharCode(65 + i)}</span>
              <input className="input" value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} placeholder={`Respuesta ${String.fromCharCode(65 + i)}`} />
              {opts.length > 2 && <button type="button" className="rounded p-1.5 text-slate-400 hover:text-red-600" onClick={() => set({ options: opts.filter((_, j) => j !== i) })} aria-label="Quitar"><Trash2 className="size-4" /></button>}
            </div>
          ))}
          {opts.length < 8 && <button type="button" className="btn-ghost text-xs" onClick={() => set({ options: [...opts, { text: "" }] })}><Plus className="size-3.5" /> Agregar respuesta</button>}
          {q.type === "multiple_choice" && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="size-4" checked={q.scoring === "partial"} onChange={(e) => set({ scoring: e.target.checked ? "partial" : "all_or_nothing" })} />
              Puntos parciales (cada acierto suma y cada error resta)
            </label>
          )}
        </fieldset>
      )}

      {q.type === "true_false" && (
        <fieldset className="flex gap-4">
          <legend className="label">Respuesta correcta</legend>
          {[true, false].map((v) => (
            <label key={String(v)} className="flex items-center gap-2 text-sm"><input type="radio" name="tf" checked={q.tf_answer === v} onChange={() => set({ tf_answer: v })} /> {v ? "Verdadero" : "Falso"}</label>
          ))}
        </fieldset>
      )}

      {q.type === "short_text" && (
        <div className="space-y-2">
          <Field label="Respuestas aceptadas (una por renglón)" htmlFor="q-accepted" hint="No distingue mayúsculas, acentos ni espacios de más.">
            <textarea id="q-accepted" rows={3} className="input" value={((cfg.accepted as string[]) ?? []).join("\n")} onChange={(e) => set({ config: { ...cfg, accepted: e.target.value.split("\n") } })} />
          </Field>
        </div>
      )}

      {q.type === "open_text" && (
        <Field label="Guía para quien califica (opcional)" htmlFor="q-rubric" hint="Qué debe mencionar una buena respuesta. Solo la ve el evaluador.">
          <textarea id="q-rubric" rows={2} className="input" value={(cfg.rubric as string) ?? ""} onChange={(e) => set({ config: { ...cfg, rubric: e.target.value } })} />
        </Field>
      )}

      {q.type === "ordering" && (
        <fieldset className="space-y-2">
          <legend className="label">Escribe los elementos en el orden correcto (se mezclan al presentar)</legend>
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-xs font-semibold text-slate-400">{i + 1}</span>
              <input className="input" value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} />
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp className="size-4" /></button>
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" disabled={i === opts.length - 1} onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown className="size-4" /></button>
              {opts.length > 2 && <button type="button" className="rounded p-1.5 text-slate-400 hover:text-red-600" onClick={() => set({ options: opts.filter((_, j) => j !== i) })} aria-label="Quitar"><Trash2 className="size-4" /></button>}
            </div>
          ))}
          {opts.length < 10 && <button type="button" className="btn-ghost text-xs" onClick={() => set({ options: [...opts, { text: "" }] })}><Plus className="size-3.5" /> Agregar elemento</button>}
        </fieldset>
      )}

      {q.type === "matching" && (
        <fieldset className="space-y-2">
          <legend className="label">Pares correctos (las parejas se mezclan al presentar)</legend>
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input" value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} placeholder="Concepto" aria-label={`Concepto ${i + 1}`} />
              <span className="text-slate-400">=</span>
              <input className="input" value={o.match_target ?? ""} onChange={(e) => setOpt(i, { match_target: e.target.value })} placeholder="Pareja" aria-label={`Pareja ${i + 1}`} />
              {opts.length > 2 && <button type="button" className="rounded p-1.5 text-slate-400 hover:text-red-600" onClick={() => set({ options: opts.filter((_, j) => j !== i) })} aria-label="Quitar"><Trash2 className="size-4" /></button>}
            </div>
          ))}
          {opts.length < 10 && <button type="button" className="btn-ghost text-xs" onClick={() => set({ options: [...opts, { text: "", match_target: "" }] })}><Plus className="size-3.5" /> Agregar par</button>}
        </fieldset>
      )}

      {q.type === "scale" && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Desde" htmlFor="q-min"><input id="q-min" type="number" className="input" value={Number(cfg.min ?? 1)} onChange={(e) => set({ config: { ...cfg, min: Number(e.target.value) } })} /></Field>
          <Field label="Hasta" htmlFor="q-max"><input id="q-max" type="number" className="input" value={Number(cfg.max ?? 5)} onChange={(e) => set({ config: { ...cfg, max: Number(e.target.value) } })} /></Field>
          <Field label="Texto del mínimo" htmlFor="q-minl"><input id="q-minl" className="input" value={(cfg.min_label as string) ?? ""} onChange={(e) => set({ config: { ...cfg, min_label: e.target.value } })} placeholder="Nada" /></Field>
          <Field label="Texto del máximo" htmlFor="q-maxl"><input id="q-maxl" className="input" value={(cfg.max_label as string) ?? ""} onChange={(e) => set({ config: { ...cfg, max_label: e.target.value } })} placeholder="Mucho" /></Field>
          <p className="text-xs text-slate-500 sm:col-span-4">Es una pregunta de opinión: no suma a la calificación.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dificultad" htmlFor="q-diff">
          <select id="q-diff" className="input" value={q.difficulty ?? "medium"} onChange={(e) => set({ difficulty: e.target.value as QuestionInput["difficulty"] })}>
            {Object.entries(DIFFICULTY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Tema" htmlFor="q-topic"><input id="q-topic" className="input" value={q.topic ?? ""} onChange={(e) => set({ topic: e.target.value })} placeholder="Ej. Seguridad" /></Field>
        <Field label="Categoría del banco" htmlFor="q-cat">
          <select id="q-cat" className="input" value={q.category_id ?? ""} onChange={(e) => set({ category_id: e.target.value || null })}>
            <option value="">Sin categoría</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Explicación (se muestra al revisar el examen)" htmlFor="q-expl">
        <textarea id="q-expl" rows={2} className="input" value={q.explanation ?? ""} onChange={(e) => set({ explanation: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending && <Loader2 className="size-4 animate-spin" />} Guardar pregunta</button>
      </div>
    </div>
  );
}
