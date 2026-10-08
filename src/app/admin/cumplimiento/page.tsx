import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { Users } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { getOrgOptions } from "@/features/org/queries";
import {
  dashboardBreakdown, dashboardPeople, dashboardSummary, filterOptions, parseFilters, PEOPLE_PAGE, type GroupRow,
} from "@/features/dashboards/queries";
import { FilterBar } from "@/features/dashboards/ui/filter-bar";
import { BarList, Compliance, PctBar, pctText } from "@/features/dashboards/ui/widgets";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Cumplimiento" };

const VIEWS = [["personas", "Personas"], ["departamentos", "Departamentos"], ["cursos", "Cursos"], ["sucursales", "Sucursales"], ["empresas", "Empresas"]] as const;
type View = (typeof VIEWS)[number][0];
const SORTS = [["compliance", "Peor cumplimiento primero"], ["-compliance", "Mejor cumplimiento primero"], ["overdue", "Más vencidos primero"], ["name", "Nombre"]] as const;

export default async function CompliancePage({ searchParams }: PageProps<"/admin/cumplimiento">) {
  const ctx = await requirePermission("progress.read", "/admin/cumplimiento");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const view: View = (VIEWS.find(([k]) => k === s("vista"))?.[0]) ?? "personas";
  const sort = SORTS.find(([k]) => k === s("orden"))?.[0] ?? "compliance";
  const page = Math.max(1, Number(s("pagina")) || 1);
  const f = parseFilters(sp);
  const teamOnly = ctx.roles.length > 0 && ctx.roles.every((r) => r.scope_type === "team");

  const [summary, org, opts] = await Promise.all([dashboardSummary(f), getOrgOptions(), filterOptions()]);
  const e = summary.enrollments;

  const tabHref = (v: View) => {
    const usp = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (typeof val === "string" && val && !["vista", "pagina", "orden"].includes(k)) usp.set(k, val);
    if (v !== "personas") usp.set("vista", v);
    const q = usp.toString();
    return `/admin/cumplimiento${q ? `?${q}` : ""}`;
  };
  const views = VIEWS.filter(([k]) => k !== "empresas" || org.companies.length > 1);

  return (
    <div className="space-y-5">
      <PageHeader
        title={teamOnly ? "Cumplimiento de mi equipo" : "Cumplimiento"}
        description="Cursos obligatorios asignados y vigentes. Verde: 90 % o más · Amarillo: 70 a 89 % · Rojo: menos de 70 %."
      />

      <FilterBar action="/admin/cumplimiento" sp={sp} org={org} courses={opts.courses} managers={opts.managers} keep={["vista"]}
        fields={view === "personas"
          ? ["q", "empresa", "sucursal", "departamento", "puesto", "jefe", "curso", "semaforo", "estado", "fechas"]
          : ["empresa", "sucursal", "departamento", "puesto", "jefe", "curso", "fechas"]} />

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="card p-4"><p className="text-xs font-medium text-slate-500">Cumplimiento</p><p className="mt-1"><Compliance value={e.compliance} size="lg" /></p></div>
        <Stat label="Asignados" value={e.assigned.toLocaleString("es-MX")} hint={`${e.people_with_courses} personas`} />
        <Stat label="Completados" value={e.completed.toLocaleString("es-MX")} tone="green" />
        <Stat label="Pendientes en tiempo" value={e.pending.toLocaleString("es-MX")} hint={e.due_week ? `${e.due_week} vencen esta semana` : undefined} />
        <Stat label="Vencidos" value={e.overdue.toLocaleString("es-MX")} tone={e.overdue ? "red" : undefined} hint={e.overdue ? `${e.overdue_people} personas` : undefined} />
        <Stat label="Reprobados" value={e.failed.toLocaleString("es-MX")} tone={e.failed ? "red" : undefined} hint={e.avg_score != null ? `Promedio ${pctText(e.avg_score)}` : undefined} />
      </section>

      <nav aria-label="Vistas" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {views.map(([k, l]) => (
          <Link key={k} href={tabHref(k)} aria-current={view === k ? "page" : undefined}
            className={clsx("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium", view === k ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {l}
          </Link>
        ))}
      </nav>

      {view === "personas" ? <PeopleView f={f} sp={sp} sort={sort} page={page} /> : (
        <GroupView rows={await dashboardBreakdown(
          view === "departamentos" ? "department" : view === "cursos" ? "course" : view === "sucursales" ? "branch" : "company", f)}
          view={view} tabHref={tabHref} />
      )}
    </div>
  );
}

async function PeopleView({ f, sp, sort, page }: { f: ReturnType<typeof parseFilters>; sp: Record<string, string | string[] | undefined>; sort: string; page: number }) {
  const { total, rows } = await dashboardPeople(f, sort, page);
  const pages = Math.max(1, Math.ceil(total / PEOPLE_PAGE));
  return (
    <section aria-label="Personas" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{total.toLocaleString("es-MX")} persona{total === 1 ? "" : "s"}</p>
        <form className="flex items-center gap-2" action="/admin/cumplimiento">
          {Object.entries(sp).map(([k, v]) => typeof v === "string" && v && !["orden", "pagina"].includes(k) && <input key={k} type="hidden" name={k} value={v} />)}
          <label htmlFor="orden" className="text-xs text-slate-500">Ordenar</label>
          <select id="orden" name="orden" defaultValue={sort} className="input w-auto py-1.5 text-sm">
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn-secondary py-1.5">Ordenar</button>
        </form>
      </div>
      {rows.length === 0 ? <EmptyState icon={<Users className="size-8" />} title="Nadie coincide con esos filtros" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Empleado</th><th className="th">Empresa</th><th className="th">Departamento</th>
                <th className="th text-right">Asignados</th><th className="th text-right">Completados</th><th className="th text-right">Pendientes</th>
                <th className="th text-right">Vencidos</th><th className="th">Cumplimiento</th><th className="th text-right">Promedio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="td">
                    <Link href={`/admin/usuarios/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.full_name}</Link>
                    <div className="text-xs text-slate-500">{[r.employee_number, r.position].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="td text-slate-600">{r.company}{r.branch ? <div className="text-xs text-slate-500">{r.branch}</div> : null}</td>
                  <td className="td text-slate-600">{r.department ?? "—"}</td>
                  <td className="td text-right tabular-nums">{r.assigned}</td>
                  <td className="td text-right tabular-nums">{r.completed}</td>
                  <td className="td text-right tabular-nums">{r.pending}</td>
                  <td className={clsx("td text-right tabular-nums", r.overdue && "font-medium text-red-600")}>{r.overdue}{r.failed ? <div className="text-xs font-normal text-red-600">{r.failed} reprobado{r.failed === 1 ? "" : "s"}</div> : null}</td>
                  <td className="td w-40">{r.assigned ? <div className="space-y-1"><Compliance value={r.compliance} /><PctBar value={r.compliance} /></div> : <span className="text-xs text-slate-400">Sin cursos</span>}</td>
                  <td className="td text-right tabular-nums">{pctText(r.avg_score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={pages} params={sp} />
    </section>
  );
}

function GroupView({ rows, view, tabHref }: { rows: GroupRow[]; view: View; tabHref: (v: View) => string }) {
  if (rows.length === 0) return <EmptyState title="Sin cursos asignados con esos filtros" />;
  const isCourse = view === "cursos";
  const sorted = isCourse ? [...rows].sort((a, b) => (b.failed - a.failed) || ((a.compliance ?? 0) - (b.compliance ?? 0))) : rows;
  const param = view === "departamentos" ? "departamento" : view === "sucursales" ? "sucursal" : view === "empresas" ? "empresa" : "curso";
  const drill = (id: string | null) => {
    if (!id) return undefined;
    const u = new URL(tabHref("personas"), "http://x");
    u.searchParams.set(param, id);
    return u.pathname + u.search;
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {!isCourse && <th className="th w-10">#</th>}
              <th className="th">{isCourse ? "Curso" : view === "departamentos" ? "Departamento" : view === "sucursales" ? "Sucursal" : "Empresa"}</th>
              <th className="th text-right">Personas</th><th className="th text-right">Asignados</th><th className="th text-right">Completados</th>
              <th className="th text-right">Pendientes</th><th className="th text-right">Vencidos</th><th className="th text-right">Reprobados</th>
              <th className="th">Cumplimiento</th><th className="th text-right">Promedio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((r, i) => (
              <tr key={r.id ?? "none"}>
                {!isCourse && <td className="td tabular-nums text-slate-400">{i + 1}</td>}
                <td className="td">
                  {r.id ? <Link href={drill(r.id)!} className="font-medium text-slate-900 hover:underline">{r.name}</Link> : <span className="text-slate-500">{r.name}</span>}
                  {r.code && <div className="text-xs text-slate-500">{r.code}</div>}
                </td>
                <td className="td text-right tabular-nums">{r.users}</td>
                <td className="td text-right tabular-nums">{r.assigned}</td>
                <td className="td text-right tabular-nums">{r.completed}</td>
                <td className="td text-right tabular-nums">{r.pending}</td>
                <td className={clsx("td text-right tabular-nums", r.overdue && "font-medium text-red-600")}>{r.overdue}</td>
                <td className={clsx("td text-right tabular-nums", r.failed && "font-medium text-red-600")}>{r.failed}{r.fail_rate != null && r.failed ? <div className="text-xs font-normal">{pctText(r.fail_rate)} de quienes presentaron</div> : null}</td>
                <td className="td w-40"><div className="space-y-1"><Compliance value={r.compliance} /><PctBar value={r.compliance} /></div></td>
                <td className="td text-right tabular-nums">{pctText(r.avg_score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">{isCourse ? "Cursos con más reprobados" : "Ranking por cumplimiento"}</h2>
        <BarList rows={(isCourse ? sorted.filter((r) => r.failed > 0) : sorted).slice(0, 10).map((r) => ({
          key: r.id ?? "none", label: r.name, href: drill(r.id),
          value: isCourse ? r.fail_rate : r.compliance, tone: isCourse ? ("red" as const) : undefined,
          meta: isCourse ? `${r.failed} reprobado${r.failed === 1 ? "" : "s"} de ${r.users} persona${r.users === 1 ? "" : "s"}` : `${r.users} personas · ${r.overdue} vencidos`,
        }))} empty={isCourse ? "Ningún curso tiene reprobados" : undefined} />
      </aside>
    </div>
  );
}
