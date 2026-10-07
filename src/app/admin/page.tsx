import Link from "next/link";
import { AlertTriangle, ChevronRight, Users } from "lucide-react";
import { requireAdmin, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fmtRelative, greeting } from "@/lib/format";
import { actionLabel } from "@/lib/audit-labels";
import { Alert, Card, EmptyState, Stat } from "@/components/ui";
import { pendingReviews } from "@/features/grading/queries";

type AuditRow = { id: number; occurred_at: string; actor_name: string | null; action: string; new_data: Record<string, unknown> | null };

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  const ctx = await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const canUsers = can(ctx, "users.read");

  const count = async (filter: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count } = await filter(base());
    return count ?? 0;
  };
  function base() {
    return supabase.from("profiles").select("id", { count: "exact", head: true });
  }

  const [total, active, inactive, noDept, noManager] = canUsers
    ? await Promise.all([
        count((q) => q.neq("status", "deleted")),
        count((q) => q.eq("status", "active")),
        count((q) => q.in("status", ["inactive", "suspended"])),
        count((q) => q.eq("status", "active").is("department_id", null)),
        count((q) => q.eq("status", "active").is("manager_id", null)),
      ])
    : [0, 0, 0, 0, 0];

  const toGrade = can(ctx, "grading.grade") ? (await pendingReviews().catch(() => [])).length : 0;
  const activity = can(ctx, "audit.read")
    ? ((await supabase.rpc("search_audit", { p_limit: 8 })).data as AuditRow[] | null) ?? []
    : [];

  return (
    <div className="space-y-6">
      {sp["sin-permiso"] && <Alert kind="warning">No tienes permiso para abrir esa sección.</Alert>}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{greeting(ctx.profile.company.timezone)}, {ctx.profile.first_name}</h1>
        <p className="mt-1 text-sm text-slate-500">Resumen de la plataforma de capacitación.</p>
      </div>

      {canUsers && (
        <section aria-label="Usuarios" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Usuarios" value={total} hint="Sin contar bajas" />
          <Stat label="Activos" value={active} tone="green" />
          <Stat label="Inactivos o suspendidos" value={inactive} />
          <Stat label="Cursos publicados" value="—" hint="Fase 2" />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Requiere atención">
          <ul className="divide-y divide-slate-100">
            {toGrade > 0 && (
              <AttentionItem href="/admin/calificaciones" tone="amber" text={`${toGrade} respuesta${toGrade === 1 ? "" : "s"} de examen por calificar`} />
            )}
            {canUsers && noDept > 0 && (
              <AttentionItem href="/admin/usuarios?sin=departamento" tone="amber" text={`${noDept} usuario${noDept === 1 ? "" : "s"} activo${noDept === 1 ? "" : "s"} sin departamento`} />
            )}
            {canUsers && noManager > 0 && (
              <AttentionItem href="/admin/usuarios?sin=jefe" tone="amber" text={`${noManager} usuario${noManager === 1 ? "" : "s"} activo${noManager === 1 ? "" : "s"} sin jefe directo`} />
            )}
            {toGrade === 0 && (!canUsers || (noDept === 0 && noManager === 0)) && (
              <li className="py-2 text-sm text-slate-500">Sin pendientes. Los cursos vencidos, exámenes por calificar y vencimientos próximos aparecerán aquí a partir de las fases 3 y 4.</li>
            )}
          </ul>
        </Card>

        <Card title="Actividad reciente" actions={can(ctx, "audit.read") ? <Link href="/admin/auditoria" className="text-xs font-medium text-brand-700 hover:underline">Ver bitácora</Link> : undefined}>
          {activity.length === 0 ? (
            <EmptyState icon={<Users className="size-7" />} title="Sin actividad que mostrar" />
          ) : (
            <ul className="space-y-2.5">
              {activity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-slate-700">
                    <span className="font-medium text-slate-900">{a.actor_name ?? "Sistema"}</span> · {actionLabel(a.action)}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{fmtRelative(a.occurred_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function AttentionItem({ href, text, tone }: { href: string; text: string; tone: "red" | "amber" }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-2.5 py-2.5 text-sm text-slate-700 hover:text-slate-900">
        <AlertTriangle className={tone === "red" ? "size-4 text-red-500" : "size-4 text-amber-500"} aria-hidden />
        <span className="flex-1">{text}</span>
        <ChevronRight className="size-4 text-slate-400" aria-hidden />
      </Link>
    </li>
  );
}
