import Link from "next/link";
import { AlertTriangle, BookOpen, CheckCircle2, Clock, Download } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { myEnrollments } from "@/features/learning/queries";
import { certificatesByEnrollment } from "@/features/certificates/queries";
import { CourseCard } from "@/features/learning/ui/course-card";
import { daysLeft, fmtDate } from "@/lib/format";
import { Alert, Card, EmptyState, Stat } from "@/components/ui";

export default async function EmployeeHome({ searchParams }: PageProps<"/">) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const tz = ctx.profile.company.timezone;
  const [list, certs] = await Promise.all([myEnrollments(), certificatesByEnrollment(ctx.profile.id)]);
  const pending = list.filter((e) => e.progress_status !== "completed");
  const completed = list.filter((e) => e.progress_status === "completed");
  const dueSoon = pending.filter((e) => { const d = daysLeft(e.due_at); return d !== null && d <= 7; });
  const overdue = pending.filter((e) => (daysLeft(e.due_at) ?? 1) < 0).length;
  const compliance = list.length ? Math.round((completed.length / list.length) * 100) : null;
  const scored = list.filter((e) => e.final_score != null && (e.result === "passed" || e.result === "failed"));
  const average = scored.length ? Math.round(scored.reduce((t, e) => t + Number(e.final_score), 0) / scored.length) : null;

  return (
    <div className="space-y-6">
      {sp.contrasena === "actualizada" && <Alert kind="success">Tu contraseña se actualizó correctamente.</Alert>}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Hola, {ctx.profile.first_name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {[ctx.profile.position?.name, ctx.profile.department?.name, ctx.profile.company.name].filter(Boolean).join(" · ")}
        </p>
      </div>

      <section aria-label="Mi desempeño" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Mi progreso" value={compliance === null ? "—" : `${compliance}%`} hint="Cursos terminados de los asignados" tone={compliance !== null && compliance >= 90 ? "green" : undefined} />
        <Stat label="Pendientes" value={pending.length} hint={overdue ? `${overdue} vencido${overdue === 1 ? "" : "s"}` : undefined} tone={overdue ? "amber" : undefined} />
        <Stat label="Completados" value={completed.length} tone="green" />
        <Stat label="Promedio" value={average === null ? "—" : `${average}%`} hint="De tus exámenes calificados" />
      </section>

      {dueSoon.length > 0 && (
        <Alert kind="warning" title={`${dueSoon.length} curso${dueSoon.length === 1 ? "" : "s"} por vencer o vencido${dueSoon.length === 1 ? "" : "s"}`}>
          <ul className="mt-1 space-y-0.5">
            {dueSoon.map((e) => {
              const d = daysLeft(e.due_at)!;
              return <li key={e.id}><Link href={`/cursos/${e.id}`} className="underline">{e.course?.title}</Link> — {d < 0 ? `venció el ${fmtDate(e.due_at, tz)}` : d === 0 ? "vence hoy" : `vence en ${d} día${d === 1 ? "" : "s"}`}</li>;
            })}
          </ul>
        </Alert>
      )}

      <Card title="Cursos pendientes" actions={pending.length > 3 ? <Link href="/cursos" className="text-xs font-medium text-brand-700 hover:underline">Ver todos</Link> : undefined}>
        {pending.length === 0 ? (
          <EmptyState icon={list.length ? <CheckCircle2 className="size-8" /> : <BookOpen className="size-8" />} title={list.length ? "¡Estás al día!" : "Aún no tienes cursos asignados"}>
            {list.length ? "No tienes cursos pendientes." : "Cuando te asignen un curso aparecerá aquí con su fecha límite y tu avance."}
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{pending.slice(0, 6).map((e) => <CourseCard key={e.id} e={e} tz={tz} />)}</div>
        )}
      </Card>

      <Card title="Completados recientemente">
        {completed.length === 0 ? <EmptyState icon={<Clock className="size-7" />} title="Todavía no completas cursos" /> : (
          <ul className="divide-y divide-slate-100">
            {completed.slice(0, 5).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-slate-800"><CheckCircle2 className="size-4 text-emerald-600" /> {e.course?.title}</span>
                <span className="flex items-center gap-3 text-xs text-slate-500">
                  {e.final_score != null && <span className="font-medium text-slate-700">{Number(e.final_score)}%</span>}
                  {fmtDate(e.content_completed_at, tz)}
                  {certs.get(e.id)?.status === "valid" && (
                    <a href={`/api/certificates/${certs.get(e.id)!.id}/pdf`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><Download className="size-3.5" /> Constancia</a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {overdue > 0 && <p className="flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="size-3.5" /> Si un curso venció, todavía puedes terminarlo salvo que tu administrador lo haya cerrado.</p>}
    </div>
  );
}
