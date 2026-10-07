"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { gradeAnswer } from "./actions";
import type { PendingReview } from "./queries";

/** Bandeja "Exámenes pendientes de revisión" (§13): respuesta, puntos máximos, % y retroalimentación. */
export function GradingInbox({ items }: { items: PendingReview[] }) {
  if (items.length === 0) return <EmptyState icon={<CheckCircle2 className="size-8" />} title="No hay respuestas por calificar">Cuando alguien entregue un examen con preguntas abiertas, aparecerán aquí.</EmptyState>;
  return <div className="space-y-4">{items.map((it) => <GradeCard key={it.answer_id} item={it} />)}</div>;
}

function GradeCard({ item: it }: { item: PendingReview }) {
  const router = useRouter();
  const [pct, setPct] = useState(100);
  const [feedback, setFeedback] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <article className="card p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm"><span className="font-semibold text-slate-900">{it.user.full_name}</span>{it.user.employee_number && <span className="text-slate-400"> · {it.user.employee_number}</span>}</p>
        <p className="text-xs text-slate-500">{it.course} · {it.exam} · intento {it.attempt_number} · {fmtDateTime(it.submitted_at)}</p>
      </header>
      <p className="text-sm font-medium text-slate-800">{it.prompt}</p>
      {it.rubric && <p className="mt-1 text-xs text-slate-500">Guía: {it.rubric}</p>}
      <blockquote className="mt-3 rounded-lg border-l-4 border-brand-200 bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">{it.response || <em className="text-slate-400">Sin respuesta</em>}</blockquote>
      {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
        <div>
          <label htmlFor={`pct-${it.answer_id}`} className="label">Calificación: {pct}% = {Math.round(pct * it.points) / 100} de {it.points} pts</label>
          <input id={`pct-${it.answer_id}`} type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full accent-brand-700" />
          <div className="mt-1 flex gap-1">{[0, 50, 70, 100].map((v) => <button key={v} type="button" className="rounded border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50" onClick={() => setPct(v)}>{v}%</button>)}</div>
        </div>
        <div>
          <label htmlFor={`fb-${it.answer_id}`} className="label">Retroalimentación (la verá el empleado)</label>
          <textarea id={`fb-${it.answer_id}`} rows={2} className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await gradeAnswer(it.answer_id, pct, feedback);
          if (r.ok) router.refresh(); else setError(r.error.message);
        })}>{pending && <Loader2 className="size-4 animate-spin" />} Guardar calificación</button>
      </div>
    </article>
  );
}
