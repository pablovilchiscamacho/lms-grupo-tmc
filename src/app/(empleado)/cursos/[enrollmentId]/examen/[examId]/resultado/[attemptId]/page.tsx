import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { CheckCircle2, ChevronLeft, Clock, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { myAttemptResult, myCourseExams } from "@/features/attempts/queries";
import { fmtDuration } from "@/lib/format";
import { Alert, Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Resultado" };

export default async function ResultPage({ params }: PageProps<"/cursos/[enrollmentId]/examen/[examId]/resultado/[attemptId]">) {
  await requireUser();
  const { enrollmentId, examId, attemptId } = await params;
  const [r, exams] = await Promise.all([myAttemptResult(attemptId), myCourseExams(enrollmentId)]);
  if (!r) notFound();
  const exam = exams.find((e) => e.id === examId);
  const pending = r.status === "pending_review";
  const canRetry = exam && !exam.passed && exam.can_retry && !exam.pending;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={`/cursos/${enrollmentId}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="size-4" /> Volver al curso</Link>
      <div className="card p-6 text-center">
        <p className="text-sm text-slate-500">{r.exam_title} · intento {r.attempt_number}</p>
        {!r.visible ? (
          <><Clock className="mx-auto mt-3 size-10 text-slate-400" /><h1 className="mt-2 text-xl font-semibold text-slate-900">Examen entregado</h1>
            <p className="mt-1 text-sm text-slate-500">{pending ? "Tiene respuestas que se califican a mano. Verás tu resultado cuando terminen de revisarlo." : "Tu administrador te dará a conocer el resultado."}</p></>
        ) : (
          <>
            {pending ? <Clock className="mx-auto mt-3 size-10 text-amber-500" /> : r.passed ? <CheckCircle2 className="mx-auto mt-3 size-10 text-emerald-600" /> : <XCircle className="mx-auto mt-3 size-10 text-red-500" />}
            <p className={clsx("mt-2 text-4xl font-semibold tabular-nums", pending ? "text-amber-600" : r.passed ? "text-emerald-600" : "text-red-600")}>{Number(r.score_pct)}%</p>
            <h1 className="mt-1 text-lg font-semibold text-slate-900">{pending ? "Calificación preliminar · en revisión" : r.passed ? "¡Aprobaste!" : "No alcanzaste la calificación mínima"}</h1>
            <p className="mt-1 text-sm text-slate-500">Mínimo para aprobar: {Number(r.passing_score)}%{r.duration_seconds ? ` · tardaste ${fmtDuration(r.duration_seconds)}` : ""}{r.submitted_by === "timeout" ? " · se entregó al terminar el tiempo" : ""}</p>
          </>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {canRetry && <Link href={`/cursos/${enrollmentId}/examen/${examId}`} className="btn-primary">Volver a intentar</Link>}
          <Link href="/cursos" className="btn-secondary">Mis cursos</Link>
        </div>
      </div>

      {r.review && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Revisión de tus respuestas</h2>
          {r.review.map((q) => {
            const key = q.answer_key as { correct?: string[]; order?: string[]; pairs?: Record<string, string>; accepted?: string[]; explanation?: string | null } | null;
            const optText = (id: string) => q.snapshot.options.find((o) => o.id === id)?.text ?? "";
            const resp = q.response ?? {};
            const yours =
              q.type === "multiple_choice" ? ((resp.option_ids as string[]) ?? []).map(optText).join(", ")
              : q.type === "single_choice" || q.type === "true_false" ? optText(resp.option_id as string)
              : q.type === "ordering" ? ((resp.order as string[]) ?? []).map(optText).join(" → ")
              : q.type === "matching" ? Object.entries((resp.pairs as Record<string, string>) ?? {}).map(([l, t]) => `${optText(l)} = ${q.snapshot.targets?.find((x) => x.id === t)?.text ?? ""}`).join("; ")
              : q.type === "scale" ? String(resp.value ?? "") : String(resp.text ?? "");
            const correct = key && (
              key.correct ? key.correct.map(optText).join(", ")
              : key.order ? key.order.map(optText).join(" → ")
              : key.pairs ? Object.keys(key.pairs).map((l) => `${optText(l)} = ${q.snapshot.targets?.find((x) => x.id === l)?.text ?? ""}`).join("; ")
              : key.accepted ? key.accepted.join(" / ") : null);
            return (
              <article key={q.position} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-900">{q.position}. {q.prompt}</p>
                  {q.pending ? <Badge tone="amber">En revisión</Badge> : q.points > 0 ? <Badge tone={q.correct ? "green" : q.earned && q.earned > 0 ? "amber" : "red"}>{Number(q.earned ?? 0)} / {Number(q.points)}</Badge> : <Badge>Opinión</Badge>}
                </div>
                <p className="mt-2 text-sm text-slate-600"><span className="text-xs text-slate-400">Tu respuesta: </span>{yours || <em>Sin responder</em>}</p>
                {correct && !q.correct && <p className="mt-1 text-sm text-emerald-700"><span className="text-xs text-slate-400">Correcta: </span>{correct}</p>}
                {key?.explanation && <p className="mt-1 text-xs text-slate-500">{key.explanation}</p>}
                {q.feedback && <div className="mt-2"><Alert kind="info" title="Comentario del evaluador">{q.feedback}</Alert></div>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
