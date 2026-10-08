import Link from "next/link";
import { Activity } from "lucide-react";
import { requireAdmin, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fmtRelative, greeting } from "@/lib/format";
import { Alert, Card, EmptyState, Stat } from "@/components/ui";
import { pendingReviews } from "@/features/grading/queries";
import { dashboardActivity, dashboardBreakdown, dashboardSummary, type ActivityRow } from "@/features/dashboards/queries";
import { AttentionItem, BarList, Compliance, KpiGroup, pctText } from "@/features/dashboards/ui/widgets";

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("es-MX");
const plural = (k: number, one: string, many: string) => `${n(k)} ${k === 1 ? one : many}`;
const KIND: Record<ActivityRow["kind"], string> = { assigned: "recibió", completed: "terminó", passed: "aprobó", failed: "reprobó" };

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  const ctx = await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const canUsers = can(ctx, "users.read");
  const canProgress = can(ctx, "progress.read");
  const teamOnly = ctx.roles.length > 0 && ctx.roles.every((r) => r.scope_type === "team");

  const countProfiles = async (fn: (q: ReturnType<typeof profiles>) => ReturnType<typeof profiles>) => (await fn(profiles())).count ?? 0;
  function profiles() { return supabase.from("profiles").select("id", { count: "exact", head: true }); }
  const countCourses = async (status: string) =>
    (await supabase.from("courses").select("id", { count: "exact", head: true }).eq("status", status)).count ?? 0;

  const [summary, depts, activity, toGrade, noDept, noManager, courses] = await Promise.all([
    canProgress ? dashboardSummary() : null,
    canProgress && !teamOnly ? dashboardBreakdown("department") : [],
    canProgress ? dashboardActivity({}, 8) : [],
    can(ctx, "grading.grade") ? pendingReviews().then((r) => r.length).catch(() => 0) : 0,
    canUsers && !teamOnly ? countProfiles((q) => q.eq("status", "active").is("department_id", null)) : 0,
    canUsers && !teamOnly ? countProfiles((q) => q.eq("status", "active").is("manager_id", null)) : 0,
    can(ctx, "courses.read") ? Promise.all(["published", "draft", "archived"].map(countCourses)) : null,
  ]);
  const e = summary?.enrollments;
  const lowDepts = [...depts].sort((a, b) => (a.compliance ?? 0) - (b.compliance ?? 0)).slice(0, 5);

  const attention: { href: string; text: string; tone: "red" | "amber" | "green" }[] = [];
  if (e?.overdue) attention.push({ href: "/admin/cumplimiento?estado=vencidos&orden=overdue", tone: "red", text: `${plural(e.overdue, "curso vencido", "cursos vencidos")} (${plural(e.overdue_people, "persona", "personas")})` });
  if (e?.failed_people) attention.push({ href: "/admin/cumplimiento?estado=reprobados", tone: "red", text: `${plural(e.failed_people, "persona reprobada", "personas reprobadas")} sin intentos restantes` });
  if (e?.due_week) attention.push({ href: "/admin/cumplimiento?estado=por-vencer", tone: "amber", text: `${plural(e.due_week, "curso vence", "cursos vencen")} esta semana` });
  if (toGrade) attention.push({ href: "/admin/calificaciones", tone: "amber", text: `${plural(toGrade, "respuesta de examen", "respuestas de examen")} por calificar` });
  if (noDept) attention.push({ href: "/admin/usuarios?sin=departamento", tone: "amber", text: `${plural(noDept, "usuario activo", "usuarios activos")} sin departamento` });
  if (noManager) attention.push({ href: "/admin/usuarios?sin=jefe", tone: "amber", text: `${plural(noManager, "usuario activo", "usuarios activos")} sin jefe directo` });
  if (e && e.compliance !== null) {
    const c = Number(e.compliance);
    attention.push({ href: "/admin/cumplimiento", tone: c >= 90 ? "green" : c >= 70 ? "amber" : "red", text: `${pctText(c)} de cumplimiento ${teamOnly ? "de tu equipo" : "global"}` });
  }

  return (
    <div className="space-y-6">
      {sp["sin-permiso"] && <Alert kind="warning">No tienes permiso para abrir esa sección.</Alert>}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{greeting(ctx.profile.company.timezone)}, {ctx.profile.first_name}</h1>
        <p className="mt-1 text-sm text-slate-500">{teamOnly ? "Así va la capacitación de tu equipo." : "Así va la capacitación hoy."}</p>
      </div>

      {e && (
        <section aria-label="Indicadores principales" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Link href="/admin/cumplimiento" className="card p-4 hover:border-slate-300">
            <p className="text-xs font-medium text-slate-500">Cumplimiento {teamOnly ? "del equipo" : "global"}</p>
            <p className="mt-1"><Compliance value={e.compliance} size="lg" /></p>
            <p className="mt-0.5 text-xs text-slate-500">{n(e.completed)} de {n(e.assigned)} cursos obligatorios</p>
          </Link>
          <Stat label="Vencidos" value={n(e.overdue)} tone={e.overdue ? "red" : undefined} hint={e.overdue ? plural(e.overdue_people, "persona", "personas") : "Nadie atrasado"} />
          <Stat label="Promedio de calificación" value={pctText(e.avg_score)} hint={e.pass_rate != null ? `${pctText(e.pass_rate)} aprueba` : undefined} />
          <Stat label="Horas de capacitación" value={n(summary!.hours.total)} hint={summary!.hours.per_person != null ? `${summary!.hours.per_person} h por persona` : undefined} />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Requiere atención">
          {attention.length === 0 ? <p className="py-2 text-sm text-slate-500">Sin pendientes por ahora.</p> : (
            <ul className="divide-y divide-slate-100">{attention.map((a) => <AttentionItem key={a.href} {...a} />)}</ul>
          )}
        </Card>

        <Card title="Actividad reciente">
          {activity.length === 0 ? <EmptyState icon={<Activity className="size-7" />} title="Sin actividad que mostrar" /> : (
            <ul className="space-y-2.5">
              {activity.map((a, i) => (
                <li key={`${a.user_id}-${a.kind}-${a.at}-${i}`} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-slate-700">
                    <Link href={`/admin/usuarios/${a.user_id}`} className="font-medium text-slate-900 hover:underline">{a.full_name}</Link>{" "}
                    {KIND[a.kind]} {a.kind === "assigned" ? "el curso" : ""} «{a.course}»
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{fmtRelative(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(e || courses) && (
        <div className={lowDepts.length ? "grid gap-6 lg:grid-cols-2" : "grid gap-6"}>
          {lowDepts.length > 0 && (
            <Card title="Departamentos con menor cumplimiento" actions={<Link href="/admin/cumplimiento?vista=departamentos" className="text-xs font-medium text-brand-700 hover:underline">Ver ranking</Link>}>
              <BarList rows={lowDepts.map((d) => ({ key: d.id ?? d.name, label: d.name, value: d.compliance, href: d.id ? `/admin/cumplimiento?departamento=${d.id}` : undefined, meta: `${n(d.users)} personas · ${n(d.overdue)} vencidos · ${n(d.pending)} pendientes` }))} />
            </Card>
          )}
          <Card title="Indicadores">
            <div className="grid gap-5 sm:grid-cols-2">
              {summary && <KpiGroup title="Usuarios" items={[["Total", n(summary.users.total)], ["Activos", n(summary.users.active)], ["Inactivos o suspendidos", n(summary.users.inactive)]]} />}
              {courses && <KpiGroup title="Cursos" items={[["Publicados", n(courses[0])], ["Borradores", n(courses[1])], ["Archivados", n(courses[2])]]} />}
              {e && <KpiGroup title="Cumplimiento" items={[["Aprobados o completados", n(e.completed)], ["Pendientes en tiempo", n(e.pending)], ["Vencidos", n(e.overdue)], ["Reprobados", n(e.failed)]]} />}
              {e && <KpiGroup title="Exámenes" items={[["Por calificar", n(toGrade)], ["Promedio", pctText(e.avg_score)], ["Aprobación", pctText(e.pass_rate)], ["Reprobación", pctText(e.fail_rate)]]} />}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
