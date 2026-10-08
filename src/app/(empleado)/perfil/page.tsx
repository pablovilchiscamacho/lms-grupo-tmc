import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileDown, KeyRound, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { fmtDate, fmtDateTime, SCOPE_LABEL } from "@/lib/format";
import { Avatar, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { PhoneForm } from "./phone-form";
import { myHistory, type HistoryRow } from "@/features/traceability/queries";

export const metadata: Metadata = { title: "Mi perfil" };

export default async function ProfilePage() {
  const ctx = await requireUser();
  const p = ctx.profile;
  const tz = p.company.timezone;
  const history = await myHistory();
  const current = history.filter((h) => h.state === "active");
  const done = current.filter((h) => h.progress_status === "completed").length;
  const overdue = current.filter((h) => h.progress_status !== "completed" && h.result !== "failed" && h.due_at && new Date(h.due_at) < new Date()).length;
  const rows: [string, React.ReactNode][] = [
    ["Número de empleado", p.employee_number ?? "—"],
    ["Usuario", p.username ?? "—"],
    ["Correo", p.email ?? "Sin correo corporativo"],
    ["Empresa", p.company.name],
    ["Sucursal", p.branch?.name ?? "—"],
    ["Departamento", p.department?.name ?? "—"],
    ["Puesto", p.position?.name ?? "—"],
    ["Jefe directo", p.manager?.full_name ?? "—"],
    ["Fecha de ingreso", fmtDate(p.hire_date, tz)],
    ["Alta en la plataforma", fmtDate(p.created_at, tz)],
    ["Último acceso", fmtDateTime(p.last_login_at, tz)],
  ];
  return (
    <>
      <PageHeader title="Mi perfil" actions={<a href={`/api/expediente/${ctx.profile.id}`} className="btn-secondary"><FileDown className="size-4" /> Mi expediente PDF</a>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-4">
              <Avatar name={p.full_name} size={56} />
              <div>
                <p className="text-lg font-semibold text-slate-900">{p.full_name}</p>
                <p className="text-sm text-slate-500">{[p.position?.name, p.company.short_name].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-medium text-slate-500">{k}</dt>
                  <dd className="text-sm text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-slate-400">¿Algún dato es incorrecto? Pide a Recursos Humanos que lo corrija.</p>
          </Card>

          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Asignados" value={current.length} />
            <Stat label="Completados" value={done} tone="green" />
            <Stat label="Vencidos" value={overdue} tone={overdue ? "red" : undefined} />
            <Stat label="Cumplimiento" value={current.length ? `${Math.round((done / current.length) * 100)}%` : "—"} />
          </section>

          <Card title="Historial de capacitación">
            {history.length === 0 ? (
              <EmptyState title="Sin cursos todavía">Aquí verás cada curso con su fecha de asignación, intentos, calificación y estado.</EmptyState>
            ) : (
              <div className="-m-4 overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr><th className="th">Curso</th><th className="th">Asignado</th><th className="th">Fecha límite</th><th className="th">Inicio</th><th className="th">Finalización</th><th className="th text-right">Intentos</th><th className="th text-right">Calificación</th><th className="th">Estado</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((h) => (
                      <tr key={h.id} className={h.state !== "active" ? "text-slate-500" : undefined}>
                        <td className="td"><span className="font-medium text-slate-900">{h.course}</span><div className="text-xs text-slate-500">{h.version ? `v${h.version}` : ""}{h.cycle > 1 ? ` · ciclo ${h.cycle}` : ""}{h.state === "superseded" ? " · ciclo anterior" : ""}</div></td>
                        <td className="td text-sm">{fmtDate(h.assigned_at, tz)}</td>
                        <td className="td text-sm">{h.due_at ? fmtDate(h.due_at, tz) : "—"}</td>
                        <td className="td text-sm">{h.started_at ? fmtDate(h.started_at, tz) : "—"}</td>
                        <td className="td text-sm">{h.finished_at ? fmtDate(h.finished_at, tz) : "—"}</td>
                        <td className="td text-right tabular-nums">{h.attempts || "—"}</td>
                        <td className="td text-right tabular-nums">{h.final_score != null ? `${Number(h.final_score)}%` : "—"}</td>
                        <td className="td"><HistoryBadge h={h} />{h.certificate_id && <a href={`/api/certificates/${h.certificate_id}/pdf`} className="mt-1 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><Download className="size-3" /> Constancia</a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Contacto"><PhoneForm phone={p.phone ?? ""} /></Card>
          <Card title="Seguridad">
            <div className="space-y-3 text-sm">
              <Link href="/definir-contrasena" className="btn-secondary w-full"><KeyRound className="size-4" /> Cambiar contraseña</Link>
              {ctx.requires_mfa && (
                <p className="flex items-center gap-2 text-slate-600">
                  <ShieldCheck className="size-4 text-emerald-600" /> Verificación en dos pasos {ctx.aal === "aal2" ? "activa en esta sesión" : "requerida"}
                </p>
              )}
            </div>
          </Card>
          {ctx.roles.length > 0 && (
            <Card title="Mis roles">
              <ul className="space-y-2">
                {ctx.roles.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-800">{r.name}</span>
                    <Badge tone="blue">{SCOPE_LABEL[r.scope_type] ?? r.scope_type}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** Estados del historial (§6): Pendiente, En progreso, Completado, Aprobado, Reprobado y Vencido. */
function HistoryBadge({ h }: { h: HistoryRow }) {
  if (h.result === "passed") return <Badge tone="green">Aprobado</Badge>;
  if (h.result === "failed") return <Badge tone="red">Reprobado</Badge>;
  if (h.result === "pending_review") return <Badge tone="amber">En revisión</Badge>;
  if (h.progress_status === "completed") return <Badge tone="green">Completado</Badge>;
  if (h.state === "active" && h.due_at && new Date(h.due_at) < new Date()) return <Badge tone="red">Vencido</Badge>;
  if (h.progress_status === "in_progress") return <Badge tone="blue">En progreso</Badge>;
  return <Badge>Pendiente</Badge>;
}

