"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Loader2, Send } from "lucide-react";
import { Alert, Card, Field } from "@/components/ui";
import { NOTIFICATION_TYPES, type EmailSettings, type ReminderSettings } from "../catalog";
import { saveNotificationSettings, sendTestEmail } from "../actions";

const DAY_OPTIONS = [30, 14, 7, 5, 3, 2, 1, 0];

export function NotificationSettingsForm({ email, reminders, hasKey }: { email: EmailSettings; reminders: ReminderSettings; hasKey: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(email.enabled);
  const [from, setFrom] = useState(email.from);
  const [replyTo, setReplyTo] = useState(email.reply_to ?? "");
  const [types, setTypes] = useState<Record<string, boolean>>(email.types ?? {});
  const [days, setDays] = useState<number[]>(reminders.days_before ?? [7, 3, 1]);
  const [overdue, setOverdue] = useState(reminders.overdue);
  const [every, setEvery] = useState(reminders.overdue_every_days);
  const [digest, setDigest] = useState(reminders.manager_digest);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const groups = ["Empleado", "Quien califica", "Jefe"] as const;

  const save = () => start(async () => {
    const r = await saveNotificationSettings({
      email: { enabled, from, reply_to: replyTo, types },
      reminders: { days_before: [...days].sort((a, b) => b - a).slice(0, 6), overdue, overdue_every_days: every, manager_digest: digest },
    });
    setMsg(r.ok ? { ok: true, text: r.message ?? "Guardado." } : { ok: false, text: Object.values(r.error.fieldErrors ?? {})[0] ?? r.error.message });
    if (r.ok) router.refresh();
  });

  return (
    <div className="space-y-6">
      {msg && <Alert kind={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
      <Card title="Correo">
        <div className="space-y-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-0.5 size-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="text-sm">
              <span className="font-medium text-slate-900">Enviar los avisos también por correo</span>
              <span className="block text-xs text-slate-500">Los avisos siempre aparecen dentro de la plataforma; esto además los manda al correo de cada persona (quien no tiene correo, solo los ve en la plataforma).</span>
            </span>
          </label>
          {enabled && !hasKey && <Alert kind="warning">Falta conectar el servicio de envío (Resend). Los correos no saldrán hasta que se configure.</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Remitente" htmlFor="from" hint="Ej. Capacitación Grupo TMC <capacitacion@ealogistica.com>. El dominio debe estar verificado en Resend.">
              <input id="from" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Responder a (opcional)" htmlFor="reply" hint="Si alguien responde un aviso, le llega a este correo.">
              <input id="reply" type="email" className="input" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="capacitacion@ealogistica.com" />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Qué avisos se mandan por correo">
        <div className="grid gap-5 lg:grid-cols-3">
          {groups.map((g) => (
            <fieldset key={g}>
              <legend className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Para {g === "Empleado" ? "el empleado" : g === "Jefe" ? "el jefe" : "quien califica"}</legend>
              <div className="space-y-2">
                {NOTIFICATION_TYPES.filter((t) => t.who === g).map((t) => (
                  <label key={t.key} className="flex items-start gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="mt-0.5 size-4" checked={Boolean(types[t.key])} onChange={(e) => setTypes({ ...types, [t.key]: e.target.checked })} />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Card>

      <Card title="Recordatorios de fecha límite">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm text-slate-700">Avisar antes de que venza un curso:</p>
            <div className="flex flex-wrap gap-2">
              {DAY_OPTIONS.map((d) => {
                const on = days.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={on} disabled={!on && days.length >= 6}
                    onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                    className={clsx("rounded-full border px-3 py-1 text-sm", on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600 hover:border-slate-300", "disabled:opacity-40")}>
                    {d === 0 ? "El mismo día" : d === 1 ? "1 día antes" : `${d} días antes`}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="size-4" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Avisar al día siguiente de que venció
          </label>
          {overdue && (
            <label className="flex flex-wrap items-center gap-2 pl-6 text-sm text-slate-700">
              y repetir cada
              <input type="number" min={0} max={60} className="input w-20 py-1" value={every} onChange={(e) => setEvery(Number(e.target.value))} />
              días mientras siga vencido <span className="text-xs text-slate-500">(0 = no repetir)</span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="size-4" checked={digest} onChange={(e) => setDigest(e.target.checked)} /> Mandar a los jefes un resumen los lunes con su equipo atrasado
          </label>
        </div>
      </Card>

      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending} onClick={save}>{pending && <Loader2 className="size-4 animate-spin" />} Guardar configuración</button>
      </div>
    </div>
  );
}

export function TestEmailForm({ defaultTo }: { defaultTo: string }) {
  const router = useRouter();
  const [to, setTo] = useState(defaultTo);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {msg && <Alert kind={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="test-to" className="sr-only">Correo de prueba</label>
        <input id="test-to" type="email" className="input flex-1" value={to} onChange={(e) => setTo(e.target.value)} placeholder="tu.correo@empresa.com" />
        <button className="btn-secondary" disabled={pending || !to} onClick={() => start(async () => {
          const r = await sendTestEmail(to);
          setMsg(r.ok ? { ok: true, text: r.message ?? "Enviado." } : { ok: false, text: r.error.message });
          if (r.ok) router.refresh();
        })}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Mandar prueba</button>
      </div>
    </div>
  );
}
