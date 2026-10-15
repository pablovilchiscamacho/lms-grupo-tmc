import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Plus, RefreshCw } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { listAssignments } from "@/features/assignments/queries";
import { fmtDate, REQUIREMENT_LABEL } from "@/lib/format";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { audienceLabel } from "@/features/assignments/format";

export const metadata: Metadata = { title: "Asignaciones" };

export default async function AssignmentsPage({ searchParams }: PageProps<"/admin/asignaciones">) {
  const ctx = await requirePermission("assignments.read", "/admin/asignaciones");
  const sp = await searchParams;
  const list = await listAssignments({ course: typeof sp.curso === "string" ? sp.curso : undefined });
  // Un bloque por curso (el más reciente primero), con sus asignaciones adentro.
  const groups: { course: (typeof list)[number]["course"]; items: typeof list; total: number }[] = [];
  for (const a of list) {
    let g = groups.find((x) => x.course?.id === a.course?.id);
    if (!g) groups.push(g = { course: a.course, items: [], total: 0 });
    g.items.push(a);
    g.total += a.enrollments?.[0]?.count ?? 0;
  }
  return (
    <>
      <PageHeader title="Asignaciones" description="Quién debe tomar cada curso y para cuándo."
        actions={can(ctx, "assignments.write") ? <Link href="/admin/asignaciones/nueva" className="btn-primary"><Plus className="size-4" /> Nueva asignación</Link> : undefined} />
      {list.length === 0 ? <EmptyState icon={<ListChecks className="size-8" />} title="Todavía no hay asignaciones">Asigna un curso a un área, a un puesto o a personas específicas.</EmptyState> : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.course?.id ?? "x"} className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">{g.course?.title}</h2>
                  <p className="text-xs text-slate-500">{g.course?.code} · {g.total} persona{g.total === 1 ? "" : "s"} en {g.items.length} asignaci{g.items.length === 1 ? "ón" : "ones"}</p>
                </div>
                {can(ctx, "assignments.write") && g.course && <Link href={`/admin/asignaciones/nueva?curso=${g.course.id}`} className="btn-ghost text-sm"><Plus className="size-4" /> Asignar a más</Link>}
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead className="sr-only"><tr><th>A quién</th><th>Fecha límite</th><th>Personas</th><th>Estado</th><th>Creada</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.items.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="td"><Link href={`/admin/asignaciones/${a.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">{audienceLabel(a)}</Link>
                          {a.include_future_users && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-brand-700" title="Incluye a quienes entren después"><RefreshCw className="size-3" /> automática</span>}
                          <div className="text-xs text-slate-500">{REQUIREMENT_LABEL[a.requirement]}</div></td>
                        <td className="td text-slate-600">{a.due_in_days ? `${a.due_in_days} días después de asignarse` : a.due_at ? fmtDate(a.due_at) : "Sin fecha límite"}</td>
                        <td className="td tabular-nums">{a.enrollments?.[0]?.count ?? 0} personas</td>
                        <td className="td">{a.is_active ? <Badge tone="green">Activa</Badge> : <Badge>Pausada</Badge>}</td>
                        <td className="td text-slate-500">{fmtDate(a.created_at)}{a.creator && <div className="text-xs">{a.creator.full_name}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
