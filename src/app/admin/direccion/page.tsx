import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { getOrgOptions } from "@/features/org/queries";
import {
  dashboardBreakdown, dashboardPeople, dashboardSummary, dashboardTrend, parseFilters,
} from "@/features/dashboards/queries";
import { FilterBar } from "@/features/dashboards/ui/filter-bar";
import { BarList, Compliance, pctText, TrendChart } from "@/features/dashboards/ui/widgets";
import { Card, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Dirección" };

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("es-MX");

/** Tablero de Dirección (§46): solo lectura, con lo esencial para decidir. */
export default async function ExecutivePage({ searchParams }: PageProps<"/admin/direccion">) {
  await requirePermission("dashboard.executive", "/admin/direccion");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const [s, org, byCompany, byDept, byCourse, trend, top] = await Promise.all([
    dashboardSummary(f), getOrgOptions(), dashboardBreakdown("company", f), dashboardBreakdown("department", f),
    dashboardBreakdown("course", f), dashboardTrend(f), dashboardPeople(f, "-compliance", 1, 10),
  ]);
  const e = s.enrollments;
  const worstCourses = byCourse.filter((c) => c.failed > 0).sort((a, b) => (b.fail_rate ?? 0) - (a.fail_rate ?? 0) || b.failed - a.failed).slice(0, 8);
  const lowDepts = [...byDept].reverse().slice(0, 10);
  const leaders = top.rows.filter((r) => r.assigned > 0);
  const toPeople = (k: string, id: string | null) => (id ? `/admin/cumplimiento?${k}=${id}` : undefined);

  return (
    <div className="space-y-5">
      <PageHeader title="Dirección" description="Cumplimiento de la capacitación obligatoria en todo tu alcance." />
      {org.companies.length > 1 && <FilterBar action="/admin/direccion" sp={sp} org={org} fields={["empresa", "fechas"]} />}

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs font-medium text-slate-500">Cumplimiento global</p><p className="mt-1"><Compliance value={e.compliance} size="lg" /></p>
          <p className="mt-0.5 text-xs text-slate-500">{n(e.completed)} de {n(e.assigned)} cursos</p></div>
        <Stat label="Usuarios activos" value={n(s.users.active)} hint={`${n(e.people_with_courses)} con cursos asignados`} />
        <Stat label="Cursos activos" value={n(byCourse.length)} hint="Con personas asignadas" />
        <Stat label="Cursos vencidos" value={n(e.overdue)} tone={e.overdue ? "red" : undefined} hint={e.overdue ? `${n(e.overdue_people)} personas` : "Ninguno"} />
        <Stat label="Promedio de calificaciones" value={pctText(e.avg_score)} />
        <Stat label="Aprobación" value={pctText(e.pass_rate)} tone="green" hint="De quienes terminaron sus exámenes" />
        <Stat label="Reprobación" value={pctText(e.fail_rate)} tone={e.fail_rate ? "red" : undefined} />
        <Stat label="Horas de capacitación" value={n(s.hours.total)} hint={s.hours.per_person != null ? `${s.hours.per_person} h por persona` : undefined} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Evolución mensual del cumplimiento"><TrendChart rows={trend} /></Card>
        {byCompany.length > 1 ? (
          <Card title="Cumplimiento por empresa">
            <BarList rows={byCompany.map((c) => ({ key: c.id ?? c.name, label: c.name, value: c.compliance, href: toPeople("empresa", c.id), meta: `${n(c.users)} personas · ${n(c.overdue)} vencidos · promedio ${pctText(c.avg_score)}` }))} />
          </Card>
        ) : (
          <Card title="Departamentos con menor cumplimiento" actions={<Link href="/admin/cumplimiento?vista=departamentos" className="text-xs font-medium text-brand-700 hover:underline">Ver ranking</Link>}>
            <BarList rows={lowDepts.map((d) => ({ key: d.id ?? d.name, label: d.name, value: d.compliance, href: toPeople("departamento", d.id), meta: `${n(d.users)} personas · ${n(d.overdue)} vencidos` }))} />
          </Card>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {byCompany.length > 1 && (
          <Card title="Cumplimiento por departamento" actions={<Link href="/admin/cumplimiento?vista=departamentos" className="text-xs font-medium text-brand-700 hover:underline">Ranking completo</Link>}>
            <BarList rows={byDept.slice(0, 10).map((d) => ({ key: d.id ?? d.name, label: d.name, value: d.compliance, href: toPeople("departamento", d.id), meta: `${n(d.users)} personas · ${n(d.overdue)} vencidos` }))} />
          </Card>
        )}
        <Card title="Cursos con mayor reprobación" actions={<Link href="/admin/cumplimiento?vista=cursos" className="text-xs font-medium text-brand-700 hover:underline">Ver cursos</Link>}>
          <BarList rows={worstCourses.map((c) => ({ key: c.id ?? c.name, label: c.name, value: c.fail_rate, tone: "red" as const, href: toPeople("curso", c.id), meta: `${n(c.failed)} reprobados · promedio ${pctText(c.avg_score)}` }))} empty="Ningún curso tiene reprobados" />
        </Card>
        <Card title="Usuarios con mayor cumplimiento">
          {leaders.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Sin datos todavía</p> : (
            <ol className="divide-y divide-slate-100">
              {leaders.map((r, i) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-5 text-right tabular-nums text-slate-400">{i + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800">{r.full_name}</span><span className="block truncate text-xs text-slate-500">{[r.company, r.department].filter(Boolean).join(" · ")}</span></span>
                  <span className="text-right"><Compliance value={r.compliance} /><span className="block text-xs text-slate-500">prom. {pctText(r.avg_score)}</span></span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
