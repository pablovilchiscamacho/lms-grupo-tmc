import type { Metadata } from "next";
import { CheckCircle2, CircleAlert, Mail } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";
import { emailStatus, recentEmails } from "@/features/notifications/queries";
import { NOTIFICATION_TYPES } from "@/features/notifications/catalog";
import { NotificationSettingsForm, TestEmailForm } from "@/features/notifications/ui/settings-form";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Notificaciones" };

const STATUS = { pending: ["En cola", "slate"], sending: ["Enviando", "blue"], sent: ["Enviado", "green"], failed: ["Falló", "red"], cancelled: ["Cancelado", "slate"] } as const;
const typeLabel = (k: string) => (k === "test" ? "Prueba" : NOTIFICATION_TYPES.find((t) => t.key === k)?.label ?? k);

export default async function NotificationsAdmin() {
  const ctx = await requirePermission("notifications.manage", "/admin/notificaciones");
  const [s, recent] = await Promise.all([emailStatus(), recentEmails()]);
  const live = s.email.enabled && s.has_key;

  return (
    <div className="space-y-6">
      <PageHeader title="Notificaciones" description="Avisos automáticos de la plataforma y su envío por correo." />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium text-slate-500">Correo</p>
          <p className={`mt-1 flex items-center gap-1.5 text-lg font-semibold ${live ? "text-emerald-600" : "text-amber-600"}`}>
            {live ? <CheckCircle2 className="size-5" /> : <CircleAlert className="size-5" />}
            {live ? "Activo" : !s.has_key ? "Falta conectar" : "Apagado"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{s.has_key ? "Servicio de envío conectado" : "Sin servicio de envío"}</p>
        </div>
        <Stat label="En cola" value={s.pending} />
        <Stat label="Enviados (7 días)" value={s.sent_7d} tone="green" />
        <Stat label="Con error (7 días)" value={s.failed_7d} tone={s.failed_7d ? "red" : undefined} />
      </section>

      <NotificationSettingsForm email={s.email} reminders={s.reminders} hasKey={s.has_key} />

      <Card title="Mandar un correo de prueba">
        <p className="mb-3 text-sm text-slate-600">Comprueba que los correos lleguen (revisa también la carpeta de spam). Funciona aunque el envío esté apagado.</p>
        <TestEmailForm defaultTo={ctx.profile.email ?? ""} />
      </Card>

      <Card title="Últimos correos">
        {recent.length === 0 ? <EmptyState icon={<Mail className="size-7" />} title="Todavía no se ha enviado ningún correo" /> : (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr><th className="th">Fecha</th><th className="th">Para</th><th className="th">Aviso</th><th className="th">Asunto</th><th className="th">Estado</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((e) => {
                  const [label, tone] = STATUS[e.status as keyof typeof STATUS] ?? [e.status, "slate"];
                  return (
                    <tr key={e.id}>
                      <td className="td whitespace-nowrap text-slate-600">{fmtDateTime(e.sent_at ?? e.created_at)}</td>
                      <td className="td text-slate-700">{e.to_email}</td>
                      <td className="td text-slate-600">{typeLabel(e.template_key)}</td>
                      <td className="td text-slate-700">{e.subject}</td>
                      <td className="td"><Badge tone={tone}>{label}</Badge>{e.last_error && e.status !== "sent" && <div className="mt-0.5 max-w-60 truncate text-xs text-slate-500" title={e.last_error}>{e.last_error}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
