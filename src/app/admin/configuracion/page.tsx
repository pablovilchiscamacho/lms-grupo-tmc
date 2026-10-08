import type { Metadata } from "next";
import Link from "next/link";
import { Award, Bell, Building2, CheckCircle2, CircleAlert, HardDrive, ShieldCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fmtBytes, fmtDateTime, fmtRelative } from "@/lib/format";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Configuración" };

type Health = {
  jobs: { name: string; schedule: string; active: boolean; last_status: string | null; last_start: string | null; last_message: string | null; failures_24h: number }[];
  audit: { total: number; unsealed: number; oldest_unsealed: string | null };
  email: { pending: number; failed_24h: number; oldest_pending: string | null };
  attempts_open: number; attempts_overdue: number;
  users: { active: number; logins_7d: number; failed_logins_24h: number };
  db_size_bytes: number; checked_at: string;
};

const JOB_LABEL: Record<string, string> = {
  "audit-seal": "Sellar la bitácora (cada minuto)", "close-expired-attempts": "Cerrar exámenes con tiempo vencido (cada minuto)",
  "rate-limits-cleanup": "Limpiar límites de intentos (cada hora)", "daily-assignments": "Recordatorios y renovaciones (diario 8:00)",
  "compliance-snapshot": "Foto diaria de cumplimiento (1:00)", "email-dispatch": "Enviar correos (cada 2 min)", "email-expire": "Cancelar correos viejos (diario)",
};

/** Configuración y salud del sistema (Super Admin). */
export default async function SettingsPage() {
  const ctx = await requirePermission("settings.manage", "/admin/configuracion");
  const supabase = await createClient();
  const { data } = await supabase.rpc("system_health");
  const h = data as Health | null;
  const tz = ctx.profile.company.timezone;
  const jobProblems = h?.jobs.filter((j) => !j.active || j.last_status === "failed" || j.failures_24h > 0) ?? [];
  const issues = [
    ...jobProblems.map((j) => `La tarea «${JOB_LABEL[j.name] ?? j.name}» falló recientemente.`),
    ...(h && h.audit.unsealed > 50 ? [`${h.audit.unsealed} registros de la bitácora sin sellar: revisa la tarea de sellado.`] : []),
    ...(h && h.attempts_overdue > 0 ? [`${h.attempts_overdue} exámenes con tiempo vencido siguen abiertos.`] : []),
    ...(h && h.email.failed_24h > 0 ? [`${h.email.failed_24h} correos fallaron en las últimas 24 horas.`] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Configuración" description="Salud del sistema y accesos a la configuración de la plataforma." />

      {h && (
        <>
          <div className={`card flex items-start gap-3 p-4 ${issues.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            {issues.length ? <CircleAlert className="size-6 shrink-0 text-amber-600" /> : <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />}
            <div>
              <p className="font-semibold text-slate-900">{issues.length ? "Hay puntos por revisar" : "Todo funciona correctamente"}</p>
              {issues.length ? <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
                : <p className="text-sm text-slate-600">Las tareas automáticas corren a tiempo y la bitácora está al día. Revisado {fmtRelative(h.checked_at)}.</p>}
            </div>
          </div>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Usuarios activos" value={h.users.active} hint={`${h.users.logins_7d} entraron esta semana`} />
            <Stat label="Accesos fallidos (24 h)" value={h.users.failed_logins_24h} tone={h.users.failed_logins_24h > 20 ? "amber" : undefined} />
            <Stat label="Exámenes abiertos ahora" value={h.attempts_open} />
            <Stat label="Tamaño de la base" value={fmtBytes(h.db_size_bytes)} hint="Incluido en Supabase Pro: 8 GB" />
          </section>

          <Card title="Tareas automáticas">
            <div className="-m-4 overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Tarea</th><th className="th">Última ejecución</th><th className="th">Estado</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {h.jobs.map((j) => (
                    <tr key={j.name}>
                      <td className="td text-sm text-slate-800">{JOB_LABEL[j.name] ?? j.name}</td>
                      <td className="td text-sm text-slate-600">{j.last_start ? fmtDateTime(j.last_start, tz) : "—"}</td>
                      <td className="td">{!j.active ? <Badge>Pausada</Badge> : j.last_status === "failed" ? <Badge tone="red">Falló</Badge> : j.last_status ? <Badge tone="green">Bien</Badge> : <Badge>Sin ejecutar</Badge>}
                        {j.failures_24h > 0 && <div className="text-xs text-red-600">{j.failures_24h} fallas en 24 h</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Card title="Configuración">
        <ul className="grid gap-2 sm:grid-cols-2">
          {([
            ["/admin/organizacion", Building2, "Organización", "Empresas, sucursales, departamentos y puestos"],
            ["/admin/notificaciones", Bell, "Notificaciones y correo", "Qué avisos se mandan y recordatorios"],
            ["/admin/certificados", Award, "Firma de constancias", "Nombre y cargo de quien firma"],
            ["/admin/cursos/espacio", HardDrive, "Espacio usado", "Archivos y almacenamiento"],
            ["/admin/auditoria?verificar=1", ShieldCheck, "Integridad de la bitácora", "Verificar que nada se alteró"],
          ] as const).map(([href, Icon, t, d]) => (
            <li key={href}><Link href={href} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 hover:border-slate-300">
              <Icon className="mt-0.5 size-5 text-brand-600" /><span><span className="block text-sm font-medium text-slate-900">{t}</span><span className="block text-xs text-slate-500">{d}</span></span>
            </Link></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
