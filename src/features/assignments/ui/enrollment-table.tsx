"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, Loader2, MoreHorizontal } from "lucide-react";
import { Alert, Badge, EmptyState, Field } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { adjustEnrollment } from "../actions";
import type { EnrollmentRow } from "../queries";

export function statusBadge(e: Pick<EnrollmentRow, "state" | "result" | "progress_status" | "due_at" | "valid_until">) {
  if (e.state === "cancelled") return <Badge>Cancelado</Badge>;
  if (e.state === "superseded") return <Badge>Reemplazado</Badge>;
  if (e.valid_until && new Date(e.valid_until) < new Date()) return <Badge tone="amber">Renovación requerida</Badge>;
  if (e.result === "passed") return <Badge tone="green">Aprobado</Badge>;
  if (e.result === "failed") return <Badge tone="red">Reprobado</Badge>;
  if (e.result === "pending_review") return <Badge tone="amber">En revisión</Badge>;
  if (e.progress_status === "completed") return <Badge tone="green">Completado</Badge>;
  if (e.due_at && new Date(e.due_at) < new Date()) return <Badge tone="red">Vencido</Badge>;
  if (e.progress_status === "in_progress") return <Badge tone="blue">En progreso</Badge>;
  return <Badge>Pendiente</Badge>;
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Mexico_City" }) : "—");

/** Historial / participantes con acciones: prórroga, intento extra, acceso tardío, reasignar y cancelar. */
export function EnrollmentTable({ rows, exams, canAdjust, revalidate, show }: {
  rows: EnrollmentRow[]; exams: Record<string, { id: string; title: string }[]>; canAdjust: boolean; revalidate: string;
  show: { user?: boolean; course?: boolean };
}) {
  const [target, setTarget] = useState<EnrollmentRow | null>(null);
  if (rows.length === 0) return <EmptyState title="Sin cursos asignados" />;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {show.user && <th className="th">Persona</th>}{show.course && <th className="th">Curso</th>}
              <th className="th">Asignado</th><th className="th">Fecha límite</th><th className="th">Avance</th><th className="th">Calificación</th><th className="th">Estado</th>
              <th className="th w-10"><span className="sr-only">Trazabilidad</span></th>
              {canAdjust && <th className="th w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((e) => (
              <tr key={e.id} className={e.state !== "active" ? "opacity-60" : undefined}>
                {show.user && <td className="td">{e.user ? <Link href={`/admin/usuarios/${e.user.id}`} className="font-medium text-slate-900 hover:underline">{e.user.full_name}</Link> : "—"}<div className="text-xs text-slate-500">{e.user?.employee_number}</div></td>}
                {show.course && <td className="td">{e.course ? <Link href={`/admin/cursos/${e.course.id}`} className="font-medium text-slate-900 hover:underline">{e.course.title}</Link> : "—"}
                  <div className="text-xs text-slate-500">{e.version ? `v${e.version.version_number}` : ""}{e.cycle > 1 ? ` · ciclo ${e.cycle}` : ""}</div></td>}
                <td className="td text-slate-600">{fmt(e.assigned_at)}</td>
                <td className="td text-slate-600">{fmt(e.due_at)}</td>
                <td className="td"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-600" style={{ width: `${e.progress_pct}%` }} /></div><span className="text-xs tabular-nums text-slate-600">{Math.round(Number(e.progress_pct))}%</span></div></td>
                <td className="td tabular-nums">{e.final_score != null ? `${Number(e.final_score)}%` : "—"}</td>
                <td className="td">{statusBadge(e)}{e.cancel_reason && <div className="text-xs text-slate-500">{e.cancel_reason}</div>}</td>
                <td className="td"><Link href={`/admin/trazabilidad/${e.id}`} className="inline-flex rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Trazabilidad (ISO)" aria-label="Ver trazabilidad"><FileSearch className="size-4" /></Link></td>
                {canAdjust && <td className="td">{e.state === "active" && <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setTarget(e)} aria-label="Acciones"><MoreHorizontal className="size-4" /></button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target && <AdjustModal e={target} exams={target.course_version_id ? exams[target.course_version_id] ?? [] : []} revalidate={revalidate} onClose={() => setTarget(null)} />}
    </>
  );
}

const ACTIONS = [
  ["due_extension", "Dar prórroga", "Cambia la fecha límite."],
  ["extra_attempts", "Dar un intento extra", "Para volver a presentar un examen."],
  ["late_access", "Permitir terminar aunque esté vencido", ""],
  ["reassign", "Volver a asignar desde cero", "Abre un ciclo nuevo; el anterior queda en el historial."],
  ["cancel", "Cancelar la asignación", "Lo hecho se conserva en el historial."],
] as const;

function AdjustModal({ e, exams, revalidate, onClose }: { e: EnrollmentRow; exams: { id: string; title: string }[]; revalidate: string; onClose: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<(typeof ACTIONS)[number][0]>("due_extension");
  const [date, setDate] = useState("");
  const [exam, setExam] = useState(exams[0]?.id ?? "");
  const [attempts, setAttempts] = useState(1);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actions = ACTIONS.filter(([k]) => k !== "extra_attempts" || exams.length > 0);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${e.user?.full_name ?? ""} · ${e.course?.title ?? ""}`} description="Cada ajuste queda registrado con su motivo.">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <fieldset className="space-y-2">
          {actions.map(([k, l, d]) => (
            <label key={k} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${type === k ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
              <input type="radio" name="adj" checked={type === k} onChange={() => setType(k)} className="mt-0.5" />
              <span><span className="block text-sm font-medium text-slate-800">{l}</span>{d && <span className="block text-xs text-slate-500">{d}</span>}</span>
            </label>
          ))}
        </fieldset>
        {(type === "due_extension" || type === "reassign") && (
          <Field label={type === "reassign" ? "Nueva fecha límite (opcional)" : "Nueva fecha límite"} htmlFor="adj-date">
            <input id="adj-date" type="date" className="input" value={date} onChange={(ev) => setDate(ev.target.value)} />
          </Field>
        )}
        {type === "extra_attempts" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Examen" htmlFor="adj-exam"><select id="adj-exam" className="input" value={exam} onChange={(ev) => setExam(ev.target.value)}>{exams.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
            <Field label="Intentos" htmlFor="adj-n"><input id="adj-n" type="number" min={1} max={10} className="input" value={attempts} onChange={(ev) => setAttempts(Number(ev.target.value))} /></Field>
          </div>
        )}
        <Field label="Motivo" htmlFor="adj-reason" required><textarea id="adj-reason" rows={2} className="input" value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={pending || (type === "due_extension" && !date)} onClick={() => start(async () => {
            const r = await adjustEnrollment(e.id, { type, date: date || null, exam_id: type === "extra_attempts" ? exam : null, attempts, reason }, revalidate);
            if (!r.ok) return setError(r.error.fieldErrors?.reason ?? r.error.message);
            onClose(); router.refresh();
          })}>{pending && <Loader2 className="size-4 animate-spin" />} Aplicar</button>
        </div>
      </div>
    </Modal>
  );
}
