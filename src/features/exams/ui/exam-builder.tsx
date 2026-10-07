"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ClipboardList, Download, FileSpreadsheet, Library, Loader2, Pencil, Plus, Shuffle, Trash2 } from "lucide-react";
import { Alert, Badge, Card, EmptyState, Field } from "@/components/ui";
import { Modal, SubmitButton } from "@/components/ui/client";
import {
  addItems, addPool, commitQuestionImport, createExam, deleteExam, previewQuestionImport, removeItem, removePool, searchBank, updateExam, updateItem,
} from "../actions";
import { DIFFICULTY, SHORT_TYPE, type ExamRow, type QuestionInput } from "../types";
import { fromRow, QuestionEditor } from "./question-editor";

type Run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;

export function ExamBuilder({ courseId, courseCode, versionId, locked, exams, categories }: {
  courseId: string; courseCode: string; versionId: string; locked: boolean; exams: ExamRow[]; categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run: Run = (fn) => start(async () => { const r = await fn(); if (!r.ok) setError(r.error?.message ?? "Error"); else { setError(null); router.refresh(); } });

  if (exams.length === 0) {
    return (
      <EmptyState icon={<ClipboardList className="size-8" />} title="Este curso no tiene examen"
        action={!locked ? <button className="btn-primary" disabled={pending} onClick={() => run(() => createExam(courseId, versionId))}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Crear examen</button> : undefined}>
        Sin examen, el curso se da por terminado al completar sus lecciones. Con examen, se aprueba al alcanzar la calificación mínima.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}
      {locked && <Alert kind="info">El examen pertenece a la versión publicada: su contenido y reglas no se pueden cambiar. Para modificarlo, usa «Editar contenido» en el paso Contenido (se crea una versión nueva). Sí puedes activarlo o pausarlo.</Alert>}
      {exams.map((ex) => <ExamCard key={ex.id} exam={ex} locked={locked} run={run} pending={pending} categories={categories} courseCode={courseCode} />)}
      {!locked && <button className="btn-ghost" disabled={pending} onClick={() => run(() => createExam(courseId, versionId))}><Plus className="size-4" /> Agregar otro examen</button>}
    </div>
  );
}

const TIME_OPTS: [string, string][] = [["", "Sin límite"], ["15", "15 minutos"], ["30", "30 minutos"], ["45", "45 minutos"], ["60", "1 hora"], ["90", "1 h 30 min"], ["120", "2 horas"]];
const ATTEMPT_OPTS: [string, string][] = [["1", "1 intento"], ["2", "2 intentos"], ["3", "3 intentos"], ["5", "5 intentos"], ["", "Ilimitados"]];

function ExamCard({ exam: ex, locked, run, pending, categories, courseCode }: { exam: ExamRow; locked: boolean; run: Run; pending: boolean; categories: { id: string; name: string }[]; courseCode: string }) {
  const [s, setS] = useState({
    title: ex.title, time: ex.time_limit_minutes?.toString() ?? "", attempts: ex.max_attempts?.toString() ?? "", passing: Number(ex.passing_score),
    policy: ex.scoring_policy, visibility: ex.results_visibility, shuffleQ: ex.shuffle_questions, shuffleO: ex.shuffle_options,
    review: ex.allow_review, showCorrect: ex.show_correct_answers, needsContent: ex.requires_content_complete, cooldown: ex.cooldown_minutes?.toString() ?? "",
  });
  const [modal, setModal] = useState<null | "new" | "bank" | "pool" | "import" | { edit: QuestionInput; locked: boolean }>(null);
  const totalPoints = ex.items.reduce((t, i) => t + Number(i.points ?? i.question.default_points), 0) + ex.pools.reduce((t, p) => t + Number(p.points_each ?? 10) * p.draw_count, 0);
  const count = ex.items.length + ex.pools.reduce((t, p) => t + p.draw_count, 0);
  const sel = (id: string, label: string, value: string, opts: [string, string][], on: (v: string) => void) => (
    <Field label={label} htmlFor={id}><select id={id} className="input" value={value} disabled={locked} onChange={(e) => on(e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
  );
  const chk = (label: string, value: boolean, on: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-0.5 size-4" checked={value} disabled={locked} onChange={(e) => on(e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span></label>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card title={<span className="flex items-center gap-2">{ex.title} <Badge>{count} pregunta{count === 1 ? "" : "s"} · {totalPoints} pts</Badge></span>}
        actions={!locked ? <button className="text-xs text-red-600 hover:underline" onClick={() => confirm("¿Borrar este examen y su lista de preguntas? Las preguntas siguen en el banco.") && run(() => deleteExam(ex.id))}>Borrar examen</button> : undefined}>
        {!locked && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => setModal("new")}><Plus className="size-4" /> Nueva pregunta</button>
            <button className="btn-secondary" onClick={() => setModal("import")}><FileSpreadsheet className="size-4" /> Importar desde Excel</button>
            <button className="btn-secondary" onClick={() => setModal("bank")}><Library className="size-4" /> Del banco</button>
            <button className="btn-secondary" onClick={() => setModal("pool")}><Shuffle className="size-4" /> Al azar</button>
          </div>
        )}
        {ex.items.length === 0 && ex.pools.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Aún no hay preguntas. La forma más rápida: <strong>Importar desde Excel</strong> con la plantilla.</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {ex.items.map((it, i) => (
              <li key={it.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-6 text-xs font-semibold text-slate-400 tabular-nums">{i + 1}</span>
                <Badge tone="blue">{SHORT_TYPE[it.question.type]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-800" title={it.question.prompt}>{it.question.prompt}</span>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <input type="number" min={0} className="input w-20 py-1" defaultValue={it.points ?? ""} placeholder={String(it.question.default_points)} disabled={locked} aria-label="Puntos"
                    onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== it.points) run(() => updateItem(ex.id, it.id, { points: v })); }} /> pts
                </label>
                {!locked && <>
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" disabled={i === 0 || pending} onClick={() => run(() => updateItem(ex.id, it.id, { move: "up" }))} aria-label="Subir"><ArrowUp className="size-4" /></button>
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" disabled={i === ex.items.length - 1 || pending} onClick={() => run(() => updateItem(ex.id, it.id, { move: "down" }))} aria-label="Bajar"><ArrowDown className="size-4" /></button>
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setModal({ edit: fromRow(it.question), locked: it.question.is_locked })} aria-label="Editar pregunta"><Pencil className="size-4" /></button>
                  <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" disabled={pending} onClick={() => run(() => removeItem(ex.id, it.id))} aria-label="Quitar del examen"><Trash2 className="size-4" /></button>
                </>}
              </li>
            ))}
            {ex.pools.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <Shuffle className="size-4 text-slate-400" aria-hidden />
                <span className="flex-1 text-sm text-slate-800">
                  {p.draw_count} pregunta{p.draw_count === 1 ? "" : "s"} al azar
                  {p.category_id && ` de «${categories.find((c) => c.id === p.category_id)?.name ?? "categoría"}»`}
                  {p.difficulty && ` · ${DIFFICULTY[p.difficulty as keyof typeof DIFFICULTY]}`}{p.topic && ` · tema ${p.topic}`}
                </span>
                {!locked && <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => run(() => removePool(ex.id, p.id))} aria-label="Quitar grupo"><Trash2 className="size-4" /></button>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Reglas del examen">
        <div className="space-y-3">
          <Field label="Nombre" htmlFor={`t-${ex.id}`}><input id={`t-${ex.id}`} className="input" value={s.title} disabled={locked} onChange={(e) => setS({ ...s, title: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            {sel(`time-${ex.id}`, "Tiempo", s.time, TIME_OPTS, (v) => setS({ ...s, time: v }))}
            {sel(`att-${ex.id}`, "Intentos", s.attempts, ATTEMPT_OPTS, (v) => setS({ ...s, attempts: v }))}
            <Field label="Calificación mínima (%)" htmlFor={`pass-${ex.id}`}><input id={`pass-${ex.id}`} type="number" min={0} max={100} className="input" value={s.passing} disabled={locked} onChange={(e) => setS({ ...s, passing: Number(e.target.value) })} /></Field>
            {sel(`pol-${ex.id}`, "Con varios intentos, cuenta", s.policy, [["best", "La mejor"], ["last", "La última"], ["average", "El promedio"]], (v) => setS({ ...s, policy: v as typeof s.policy }))}
          </div>
          {sel(`vis-${ex.id}`, "Resultado", s.visibility, [["immediate", "Se muestra al terminar"], ["after_review", "Se muestra cuando se califica todo"], ["hidden", "No se muestra"]], (v) => setS({ ...s, visibility: v as typeof s.visibility }))}
          {sel(`cd-${ex.id}`, "Espera entre intentos", s.cooldown, [["", "Sin espera"], ["30", "30 minutos"], ["60", "1 hora"], ["1440", "1 día"]], (v) => setS({ ...s, cooldown: v }))}
          <div className="space-y-2 pt-1">
            {chk("Mezclar el orden de las preguntas", s.shuffleQ, (v) => setS({ ...s, shuffleQ: v }))}
            {chk("Mezclar el orden de las respuestas", s.shuffleO, (v) => setS({ ...s, shuffleO: v }))}
            {chk("Permitir revisar sus respuestas al terminar", s.review, (v) => setS({ ...s, review: v }))}
            {chk("Mostrar las respuestas correctas al revisar", s.showCorrect, (v) => setS({ ...s, showCorrect: v }))}
            {chk("Exigir terminar las lecciones antes del examen", s.needsContent, (v) => setS({ ...s, needsContent: v }))}
          </div>
          <label className="flex items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-700">
            <input type="checkbox" className="size-4" checked={ex.is_active} onChange={(e) => run(() => updateExam(ex.id, { is_active: e.target.checked }))} />
            Examen activo <span className="text-xs text-slate-500">(desactívalo para pausarlo)</span>
          </label>
          {!locked && (
            <div className="flex justify-end">
              <button className="btn-secondary" disabled={pending} onClick={() => run(() => updateExam(ex.id, {
                title: s.title, time_limit_minutes: s.time ? Number(s.time) : null, max_attempts: s.attempts ? Number(s.attempts) : null,
                passing_score: s.passing, scoring_policy: s.policy, results_visibility: s.visibility, shuffle_questions: s.shuffleQ, shuffle_options: s.shuffleO,
                allow_review: s.review, show_correct_answers: s.showCorrect, requires_content_complete: s.needsContent, cooldown_minutes: s.cooldown ? Number(s.cooldown) : null,
              }))}>{pending && <Loader2 className="size-4 animate-spin" />} Guardar reglas</button>
            </div>
          )}
        </div>
      </Card>

      <Modal open={modal !== null} onOpenChange={(o) => !o && setModal(null)} wide
        title={modal === "new" ? "Nueva pregunta" : modal === "bank" ? "Agregar del banco" : modal === "pool" ? "Preguntas al azar" : modal === "import" ? "Importar preguntas desde Excel" : "Editar pregunta"}>
        {modal === "new" && <QuestionEditor examId={ex.id} categories={categories} onSaved={() => { setModal(null); run(async () => ({ ok: true })); }} onCancel={() => setModal(null)} />}
        {modal && typeof modal === "object" && <QuestionEditor initial={modal.edit} locked={modal.locked} examId={ex.id} categories={categories} onSaved={() => { setModal(null); run(async () => ({ ok: true })); }} onCancel={() => setModal(null)} />}
        {modal === "bank" && <BankPicker existing={ex.items.map((i) => i.question.id)} onAdd={(ids) => { setModal(null); run(() => addItems(ex.id, ids)); }} />}
        {modal === "pool" && <PoolForm categories={categories} onAdd={(p) => { setModal(null); run(() => addPool(ex.id, p)); }} />}
        {modal === "import" && <ImportQuestions examId={ex.id} defaultCategory={courseCode} onDone={() => { setModal(null); run(async () => ({ ok: true })); }} />}
      </Modal>
    </div>
  );
}

function BankPicker({ existing, onAdd }: { existing: string[]; onAdd: (ids: string[]) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof searchBank>> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const search = () => start(async () => setRows(await searchBank(text, null)));
  const list = rows?.ok ? rows.data! : [];
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar en el banco de preguntas…" aria-label="Buscar" autoFocus />
        <button className="btn-secondary">{pending ? <Loader2 className="size-4 animate-spin" /> : "Buscar"}</button>
      </form>
      {rows && !rows.ok && <Alert kind="error">{rows.error.message}</Alert>}
      {rows?.ok && list.length === 0 && <p className="text-sm text-slate-500">Sin resultados.</p>}
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {list.map((q) => {
          const already = existing.includes(q.id);
          return (
            <li key={q.id}>
              <label className={`flex items-start gap-2 py-2 text-sm ${already ? "opacity-50" : ""}`}>
                <input type="checkbox" className="mt-0.5 size-4" disabled={already} checked={picked.has(q.id)}
                  onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(q.id); else n.delete(q.id); setPicked(n); }} />
                <span className="flex-1"><span className="text-slate-800">{q.prompt}</span>
                  <span className="block text-xs text-slate-500">{SHORT_TYPE[q.type as keyof typeof SHORT_TYPE]} · {DIFFICULTY[q.difficulty as keyof typeof DIFFICULTY]}{q.topic ? ` · ${q.topic}` : ""}{already ? " · ya está en el examen" : ""}</span></span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end"><button className="btn-primary" disabled={!picked.size} onClick={() => onAdd([...picked])}>Agregar {picked.size || ""}</button></div>
    </div>
  );
}

function PoolForm({ categories, onAdd }: { categories: { id: string; name: string }[]; onAdd: (p: Parameters<typeof addPool>[1]) => void }) {
  const [p, setP] = useState({ category_id: "", difficulty: "", topic: "", draw_count: 10, points_each: "" });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Cada persona recibe preguntas distintas tomadas al azar del banco. Ejemplo: «20 preguntas al azar de la categoría Seguridad».</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="¿Cuántas preguntas?" htmlFor="pool-n"><input id="pool-n" type="number" min={1} max={200} className="input" value={p.draw_count} onChange={(e) => setP({ ...p, draw_count: Number(e.target.value) })} /></Field>
        <Field label="Puntos de cada una (opcional)" htmlFor="pool-pts"><input id="pool-pts" type="number" min={0} className="input" value={p.points_each} onChange={(e) => setP({ ...p, points_each: e.target.value })} placeholder="Los de cada pregunta" /></Field>
        <Field label="De la categoría" htmlFor="pool-cat"><select id="pool-cat" className="input" value={p.category_id} onChange={(e) => setP({ ...p, category_id: e.target.value })}><option value="">Cualquiera</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Dificultad" htmlFor="pool-diff"><select id="pool-diff" className="input" value={p.difficulty} onChange={(e) => setP({ ...p, difficulty: e.target.value })}><option value="">Cualquiera</option>{Object.entries(DIFFICULTY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Tema (opcional)" htmlFor="pool-topic"><input id="pool-topic" className="input" value={p.topic} onChange={(e) => setP({ ...p, topic: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end"><button className="btn-primary" onClick={() => onAdd({
        category_id: p.category_id || null, difficulty: (p.difficulty || null) as "easy" | null, topic: p.topic.trim() || null,
        draw_count: p.draw_count, points_each: p.points_each === "" ? null : Number(p.points_each),
      })}>Agregar</button></div>
    </div>
  );
}

export function ImportQuestions({ examId, defaultCategory, onDone }: { examId: string | null; defaultCategory: string; onDone: () => void }) {
  const [state, action] = useActionState(previewQuestionImport, null);
  const [category, setCategory] = useState(defaultCategory);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const rows = state?.ok ? state.data! : [];
  const valid = rows.filter((r) => r.question);
  return (
    <div className="space-y-4">
      <a href="/plantillas/preguntas.xlsx" download className="btn-ghost -ml-2"><Download className="size-4" /> Descargar la plantilla de Excel (trae un ejemplo de cada tipo)</a>
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1"><label htmlFor="qfile" className="label">Archivo .xlsx</label><input id="qfile" name="file" type="file" accept=".xlsx" required className="input" /></div>
        <SubmitButton className="btn-secondary" pendingText="Leyendo…">Revisar archivo</SubmitButton>
      </form>
      {state && !state.ok && <Alert kind="error">{state.error.message}</Alert>}
      {rows.length > 0 && (
        <>
          <Alert kind={valid.length === rows.length ? "success" : "warning"}>{valid.length} de {rows.length} preguntas están listas.{valid.length < rows.length ? " Las que tienen error no se importan; corrígelas en el Excel y vuelve a subirlo." : ""}</Alert>
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto text-sm">
            {rows.map((r) => (
              <li key={r.row} className="flex items-start gap-2 py-1.5">
                <span className="w-10 shrink-0 text-xs text-slate-400">Fila {r.row}</span>
                <span className="flex-1 text-slate-800">{r.preview}{r.error && <span className="block text-xs text-red-600">{r.error}</span>}</span>
                {r.question && <Badge tone="green">{SHORT_TYPE[r.question.type]}</Badge>}
              </li>
            ))}
          </ul>
          <Field label="Guardar en la categoría del banco" htmlFor="imp-cat" hint="Así podrás reutilizarlas o sacarlas al azar en otros exámenes.">
            <input id="imp-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          {result && <Alert kind="info">{result}</Alert>}
          <div className="flex justify-end">
            <button className="btn-primary" disabled={pending || !valid.length} onClick={() => start(async () => {
              const r = await commitQuestionImport(valid.map((v) => v.question!), examId, category);
              if (!r.ok) return setResult(r.error.message);
              if (r.data!.failed.length) setResult(`Se importaron ${r.data!.created}. ${r.data!.failed.length} fallaron: ${r.data!.failed.map((f) => f.error).join("; ")}`);
              else onDone();
            })}>{pending && <Loader2 className="size-4 animate-spin" />} Importar {valid.length} pregunta{valid.length === 1 ? "" : "s"}{examId ? " al examen" : " al banco"}</button>
          </div>
        </>
      )}
    </div>
  );
}
