import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, KeyRound, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { fmtDate, fmtDateTime, SCOPE_LABEL } from "@/lib/format";
import { Avatar, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { PhoneForm } from "./phone-form";

export const metadata: Metadata = { title: "Mi perfil" };

export default async function ProfilePage() {
  const ctx = await requireUser();
  const p = ctx.profile;
  const tz = p.company.timezone;
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
            <Stat label="Asignados" value={0} />
            <Stat label="Aprobados" value={0} tone="green" />
            <Stat label="Vencidos" value={0} />
            <Stat label="Cumplimiento" value="—" />
          </section>

          <Card title="Historial de capacitación">
            <EmptyState title="Sin cursos todavía">Aquí verás cada curso con su fecha de asignación, intentos, calificación y estado.</EmptyState>
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
