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
  return (
    <>
      <PageHeader title="Asignaciones" description="Quién debe tomar cada curso y para cuándo."
        actions={can(ctx, "assignments.write") ? <Link href="/admin/asignaciones/nueva" className="btn-primary"><Plus className="size-4" /> Nueva asignación</Link> : undefined} />
      {list.length === 0 ? <EmptyState icon={<ListChecks className="size-8" />} title="Todavía no hay asignaciones">Asigna un curso a un área, a un puesto o a personas específicas.</EmptyState> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Curso</th><th className="th">A quién</th><th className="th">Fecha límite</th><th className="th">Personas</th><th className="th">Estado</th><th className="th">Creada</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="td"><Link href={`/admin/asignaciones/${a.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{a.course?.title}</Link><div className="text-xs text-slate-500">{REQUIREMENT_LABEL[a.requirement]}</div></td>
                  <td className="td">{audienceLabel(a)}{a.include_future_users && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-brand-700" title="Incluye a quienes entren después"><RefreshCw className="size-3" /> automática</span>}</td>
                  <td className="td text-slate-600">{a.due_in_days ? `${a.due_in_days} días después de asignarse` : a.due_at ? fmtDate(a.due_at) : "—"}</td>
                  <td className="td tabular-nums">{a.enrollments?.[0]?.count ?? 0}</td>
                  <td className="td">{a.is_active ? <Badge tone="green">Activa</Badge> : <Badge>Pausada</Badge>}</td>
                  <td className="td text-slate-500">{fmtDate(a.created_at)}{a.creator && <div className="text-xs">{a.creator.full_name}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
