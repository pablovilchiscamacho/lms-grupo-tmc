import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileDown, XCircle } from "lucide-react";
import clsx from "clsx";
import { requireAdmin } from "@/lib/auth/session";
import { fmtDate, fmtDateTime, fmtDuration } from "@/lib/format";
import { enrollmentTrace, type EnrollmentTrace } from "@/features/traceability/queries";
import { ATTEMPT_STATUS, describeAnswer, EVENT_LABEL, EXCEPTION_LABEL, QTYPE } from "@/features/traceability/format";
import { RESULT } from "@/features/reports/catalog";
import { Badge, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Trazabilidad" };

/** Trazabilidad ISO (§59) de una persona en un curso: responde con datos las preguntas del auditor. */
export default async function TracePage({ params }: PageProps<"/admin/trazabilidad/[enrollmentId]">) {
  const { enrollmentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(enrollmentId)) notFound();
  const ctx = await requireAdmin(`/admin/trazabilidad/${enrollmentId}`);
  let t: EnrollmentTrace;
  try { t = await enrollmentTrace(enrollmentId); } catch (e) {
    if ((e as { message?: string }).message === "FORBIDDEN") redirect("/admin?sin-permiso=1");
    notFound();
  }
  const tz = ctx.profile.company.timezone;
  const e = t.enrollment;
  const graders = [...new Set(t.attempts.flatMap((a) => a.questions.flatMap((q) => q.grades.map((g) => g.grader))))];
  const finished = t.attempts.filter((a) => a.status !== "in_progress");

  const qa: [string, React.ReactNode][] = [
    ["¿Quién creó el curso?", <>{t.course.created_by ?? "—"} · {fmtDate(t.course.created_at, tz)}</>],
    ["¿Quién lo modificó y cuándo?", <>Último cambio: {t.course.last_change_at ? fmtDateTime(t.course.last_change_at, tz) : "—"} · <Link href={`/admin/cursos/${t.course.id}?paso=historial`} className="text-brand-700 hover:underline">ver historial completo</Link></>],
    ["¿Qué versión tomó?", t.version ? <>v{t.version.number}{t.version.published_at && <> · publicada el {fmtDate(t.version.published_at, tz)} por {t.version.published_by ?? "—"}</>}{t.version.change_summary && <> · «{t.version.change_summary}»</>}</> : "Aún no la inicia"],
    ["¿Quién se lo asignó?", <>{e.assigned_by ?? "Regla automática"} · {fmtDate(e.assigned_at, tz)}{e.due_at && <> · fecha límite {fmtDate(e.due_at, tz)}</>}</>],
    ["¿Qué examen presentó?", finished.length ? finished.map((a) => `${a.exam} (intento ${a.number})`).join(", ") : "Ninguno"],
    ["¿Qué respondió?", finished.length ? "Ver el detalle de cada intento abajo (tal como lo vio)" : "—"],
    ["¿Quién calificó?", finished.length ? (graders.length ? `Automático y ${graders.join(", ")}` : "Calificación automática") : "—"],
    ["¿Qué calificación recibió?", e.final_score != null ? `${Number(e.final_score)}% · ${RESULT[e.result as keyof typeof RESULT] ?? e.result}` : RESULT[e.result as keyof typeof RESULT] ?? "—"],
    ["¿Cuándo aprobó?", e.passed_at ? fmtDateTime(e.passed_at, tz) : e.content_completed_at && e.result === "none" ? `Terminó el ${fmtDateTime(e.content_completed_at, tz)}` : "No ha aprobado"],
    ["¿Qué constancia obtuvo?", t.certificate ? <>{t.certificate.number} · {t.certificate.status === "revoked" ? "revocada" : "vigente"} · <a href={`/verify/certificate/${t.certificate.verification_code}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">verificar</a></> : "Ninguna"],
  ];

  return (
    <div className="space-y-6">
      <Link href={`/admin/usuarios/${t.person.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> {t.person.full_name}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Trazabilidad · {t.course.code}{e.cycle > 1 ? ` · ciclo ${e.cycle}` : ""}</p>
          <h1 className="text-xl font-semibold text-slate-900">{t.course.title}</h1>
          <p className="text-sm text-slate-500">{t.person.full_name}{t.person.employee_number && ` · ${t.person.employee_number}`} · {[t.person.position, t.person.department, t.person.company].filter(Boolean).join(" · ")}</p>
        </div>
        <a href={`/api/trazabilidad/${e.id}`} className="btn-primary"><FileDown className="size-4" /> Evidencia PDF</a>
      </div>

      <Card title="Respuestas para el auditor (ISO §59)">
        <dl className="divide-y divide-slate-100">
          {qa.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[230px_1fr]">
              <dt className="text-sm font-medium text-slate-600">{k}</dt>
              <dd className="text-sm text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Lecciones">
          <ul className="divide-y divide-slate-100">
            {t.lessons.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex items-center gap-2 text-slate-800">
                  {l.status === "completed" ? <CheckCircle2 className="size-4 text-emerald-600" /> : <span className="size-4 rounded-full border border-slate-300" />}
                  {l.title}{!l.required && <span className="text-xs text-slate-400">(opcional)</span>}
                </span>
                <span className="text-xs text-slate-500">{l.completed_at ? fmtDateTime(l.completed_at, tz) : "—"} · {fmtDuration(l.seconds)}</span>
              </li>
            ))}
            {t.lessons.length === 0 && <li className="py-2 text-sm text-slate-500">Aún no inicia el curso.</li>}
          </ul>
        </Card>
        <Card title="Ajustes y excepciones">
          {t.exceptions.length === 0 ? <p className="text-sm text-slate-500">Sin ajustes.</p> : (
            <ul className="space-y-2">
              {t.exceptions.map((x, i) => (
                <li key={i} className="text-sm"><span className="font-medium text-slate-900">{EXCEPTION_LABEL[x.type] ?? x.type}</span> · {x.granted_by ?? "—"} · {fmtDateTime(x.created_at, tz)}<div className="text-xs text-slate-500">Motivo: {x.reason}</div></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {t.attempts.map((a) => (
        <Card key={a.id} title={<span className="flex flex-wrap items-center gap-2">{a.exam} · intento {a.number} <Badge tone={a.status === "voided" ? "slate" : a.passed ? "green" : a.passed === false ? "red" : "amber"}>{a.status === "voided" ? "Anulado" : a.passed ? "Aprobado" : a.passed === false ? "Reprobado" : ATTEMPT_STATUS[a.status]}</Badge></span>}>
          <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Inicio</dt><dd>{fmtDateTime(a.started_at, tz)}</dd></div>
            <div><dt className="text-xs text-slate-500">Entrega</dt><dd>{a.submitted_at ? fmtDateTime(a.submitted_at, tz) : "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Duración</dt><dd>{fmtDuration(a.duration_seconds)}</dd></div>
            <div><dt className="text-xs text-slate-500">Calificación</dt><dd className="font-semibold">{a.score_pct != null ? `${Number(a.score_pct)}%` : "—"} <span className="font-normal text-slate-500">({Number(a.score_points)} de {Number(a.max_points)} pts)</span></dd></div>
          </dl>
          {a.void_reason && <p className="mb-3 text-sm text-red-700">Anulado por {a.voided_by ?? "—"}: {a.void_reason}</p>}
          {a.events.length > 0 && <p className="mb-4 text-xs text-slate-500">Eventos: {a.events.map((ev) => `${EVENT_LABEL[ev.type] ?? ev.type} ${fmtDateTime(ev.at, tz)}`).join(" · ")}</p>}
          <ol className="space-y-3">
            {a.questions.map((q) => {
              const d = describeAnswer(q);
              const pts = q.final_points ?? q.auto_points;
              return (
                <li key={q.position} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{q.position}. {q.snapshot.prompt}</p>
                    <span className={clsx("flex items-center gap-1 text-xs font-medium", q.is_correct ? "text-emerald-700" : q.is_correct === false ? "text-red-700" : "text-slate-500")}>
                      {q.is_correct ? <CheckCircle2 className="size-3.5" /> : q.is_correct === false ? <XCircle className="size-3.5" /> : null}
                      {pts != null ? `${Number(pts)} de ${Number(q.points)} pts` : "Sin calificar"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{QTYPE[q.snapshot.type] ?? q.snapshot.type}</p>
                  <p className="mt-2 text-sm"><span className="text-slate-500">Respondió:</span> <span className="whitespace-pre-wrap text-slate-900">{d.response}</span></p>
                  {d.correct && <p className="mt-1 text-sm"><span className="text-slate-500">Correcta:</span> <span className="text-emerald-800">{d.correct}</span></p>}
                  {q.grades.map((g, i) => (
                    <p key={i} className="mt-1 text-xs text-slate-600">Calificó <strong>{g.grader}</strong> · {Number(g.score_pct)}% · {fmtDateTime(g.created_at, tz)}{g.is_override && " · recalificación"}{g.feedback && <> · «{g.feedback}»</>}</p>
                  ))}
                </li>
              );
            })}
          </ol>
        </Card>
      ))}

      {t.certificate && (
        <Card title="Constancia">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Folio</dt><dd className="font-mono">{t.certificate.number}</dd></div>
            <div><dt className="text-xs text-slate-500">Emitida</dt><dd>{fmtDateTime(t.certificate.issued_at, tz)}</dd></div>
            <div><dt className="text-xs text-slate-500">Vigencia</dt><dd>{t.certificate.expires_at ? fmtDate(t.certificate.expires_at, tz) : "Sin vencimiento"}</dd></div>
            <div><dt className="text-xs text-slate-500">Estado</dt><dd>{t.certificate.status === "revoked" ? `Revocada por ${t.certificate.revoked_by ?? "—"}: ${t.certificate.revoked_reason}` : "Vigente"}</dd></div>
          </dl>
          {t.certificate.pdf_sha256 && <p className="mt-3 break-all font-mono text-[11px] text-slate-400">Huella del PDF (SHA-256): {t.certificate.pdf_sha256}</p>}
        </Card>
      )}
      {!t.includes_keys && <p className="text-xs text-slate-500">Las respuestas correctas solo las ve quien califica o audita.</p>}
    </div>
  );
}
