"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Loader2, Rocket, Users } from "lucide-react";
import type { OrgOptions } from "@/features/org/queries";
import { Alert, Card, Field } from "@/components/ui";
import { Modal, SubmitButton } from "@/components/ui/client";
import {
  deleteCourse, duplicateCourse, publishCourse, setCourseStatus, updateVersionSettings,
} from "../actions";

type Props = {
  courseId: string; code: string; title: string; status: string;
  openVersion: { id: string; version_number: number; min_completion_pct: number; sequential: boolean; passing_score: number } | null;
  publishedVersion: number | null; issues: string[]; org: OrgOptions;
  can: { publish: boolean; update: boolean; suspend: boolean; archive: boolean; delete: boolean; create: boolean; assign: boolean };
};

export function PublishPanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: { message: string } }>, okText?: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (okText || r.message ? { kind: "success", text: okText ?? r.message! } : null) : { kind: "error", text: r.error!.message });
      if (r.ok) router.refresh();
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {p.openVersion ? (
          <Card title={p.publishedVersion ? `Publicar los cambios (versión ${p.openVersion.version_number})` : "Publicar el curso"}>
            {p.issues.length > 0 ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-800"><AlertTriangle className="size-4" /> Antes de publicar falta:</p>
                <ul className="list-disc space-y-1 pl-6 text-sm text-slate-700">{p.issues.map((i) => <li key={i}>{i}</li>)}</ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> Todo listo para publicar.</p>
            )}
            <RulesForm courseId={p.courseId} version={p.openVersion} disabled={!p.can.update} />
            {p.can.publish && (
              <div className="mt-4 flex justify-end">
                <button className="btn-primary" disabled={pending || p.issues.length > 0} onClick={() => setPublishOpen(true)}>
                  <Rocket className="size-4" /> {p.publishedVersion ? "Publicar cambios" : "Publicar curso"}
                </button>
              </div>
            )}
          </Card>
        ) : (
          <Alert kind="success" title={`Versión ${p.publishedVersion} publicada`}>Para cambiar el contenido, entra al paso «Contenido» y usa «Editar contenido».</Alert>
        )}

        {p.can.assign && (p.status === "published" ? (
          <Card title="Asignar el curso">
            <p className="text-sm text-slate-600">Asígnalo a un área, a un puesto (también a quienes entren después) o a personas específicas, con su fecha límite.</p>
            <div className="mt-3"><a href={`/admin/asignaciones/nueva?curso=${p.courseId}`} className="btn-primary"><Users className="size-4" /> Asignar este curso</a></div>
          </Card>
        ) : <Alert kind="info">Podrás asignar el curso en cuanto lo publiques.</Alert>)}
      </div>

      <div className="space-y-6">
        <Card title="Estado del curso">
          <div className="space-y-2">
            {p.status === "published" && p.can.suspend && (
              <button className="btn-secondary w-full" disabled={pending} onClick={() => confirm("¿Suspender el curso? Nadie podrá tomarlo hasta reactivarlo.") && run(() => setCourseStatus(p.courseId, "suspended"), "Curso suspendido.")}>Suspender temporalmente</button>
            )}
            {p.status === "suspended" && p.can.suspend && (
              <button className="btn-secondary w-full" disabled={pending} onClick={() => run(() => setCourseStatus(p.courseId, "published"), "Curso reactivado.")}>Reactivar</button>
            )}
            {p.status !== "archived" && p.can.archive && (
              <button className="btn-secondary w-full" disabled={pending} onClick={() => confirm("¿Archivar el curso? Deja de estar disponible, pero su historial se conserva.") && run(() => setCourseStatus(p.courseId, "archived"), "Curso archivado.")}>Archivar</button>
            )}
            {p.can.create && <button className="btn-secondary w-full" onClick={() => setDupOpen(true)}><Copy className="size-4" /> Duplicar curso</button>}
            {p.can.delete && p.status !== "published" && (
              <button className="btn-ghost w-full text-red-600" disabled={pending} onClick={() => confirm("¿Borrar el curso definitivamente? Solo es posible si nunca se asignó.") && run(() => deleteCourse(p.courseId))}>Borrar curso</button>
            )}
          </div>
        </Card>
      </div>

      <Modal open={publishOpen} onOpenChange={setPublishOpen} title={p.publishedVersion ? "Publicar cambios" : "Publicar curso"}
        description={p.publishedVersion ? "Quien ya empezó el curso termina con su versión; quien no ha empezado recibe la nueva." : "Una vez publicado, el contenido de esta versión ya no se puede modificar sin crear una versión nueva."}>
        <PublishForm courseId={p.courseId} isUpdate={!!p.publishedVersion} onDone={(text) => { setPublishOpen(false); setMsg({ kind: "success", text }); router.refresh(); }} />
      </Modal>
      <Modal open={dupOpen} onOpenChange={setDupOpen} title="Duplicar curso" description="Se crea un curso nuevo en borrador con el mismo contenido. Los archivos no se copian: se reutilizan.">
        <DuplicateForm courseId={p.courseId} code={p.code} title={p.title} />
      </Modal>
    </div>
  );
}

function RulesForm({ courseId, version, disabled }: { courseId: string; version: NonNullable<Props["openVersion"]>; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [pct, setPct] = useState(Number(version.min_completion_pct));
  const [seq, setSeq] = useState(version.sequential);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <p className="mb-3 text-sm font-medium text-slate-800">Reglas de avance</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 size-4" checked={seq} disabled={disabled} onChange={(e) => setSeq(e.target.checked)} />
          <span>En orden<span className="block text-xs text-slate-500">No se puede abrir una lección sin terminar las anteriores.</span></span>
        </label>
        <label className="text-sm text-slate-700">% de lecciones obligatorias para completar
          <input type="number" min={0} max={100} className="input mt-1" value={pct} disabled={disabled} onChange={(e) => setPct(Number(e.target.value))} />
        </label>
      </div>
      {!disabled && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
          <button className="btn-secondary" disabled={pending} onClick={() => start(async () => {
            const r = await updateVersionSettings(courseId, version.id, { min_completion_pct: pct, sequential: seq, passing_score: Number(version.passing_score) });
            setMsg(r.ok ? "Guardado" : r.error.message);
          })}>Guardar reglas</button>
        </div>
      )}
    </div>
  );
}

function PublishForm({ courseId, isUpdate, onDone }: { courseId: string; isUpdate: boolean; onDone: (t: string) => void }) {
  const [summary, setSummary] = useState("");
  const [retrain, setRetrain] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {err && <Alert kind="error">{err}</Alert>}
      <Field label={isUpdate ? "¿Qué cambió? (queda en el historial)" : "Nota (opcional)"} htmlFor="summary">
        <textarea id="summary" rows={2} className="input" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={isUpdate ? "Ej. Se actualizó el reglamento 2026" : ""} />
      </Field>
      {isUpdate && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 size-4" checked={retrain} onChange={(e) => setRetrain(e.target.checked)} />
          <span>Requiere recapacitación<span className="block text-xs text-slate-500">Quienes ya lo terminaron lo recibirán de nuevo, con 30 días para tomar la versión nueva.</span></span>
        </label>
      )}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await publishCourse(courseId, summary, retrain);
          if (r.ok) onDone(isUpdate ? "Cambios publicados." : "Curso publicado. Ya puedes asignarlo.");
          else setErr(r.error.message);
        })}>{pending && <Loader2 className="size-4 animate-spin" />} Publicar</button>
      </div>
    </div>
  );
}

function DuplicateForm({ courseId, code, title }: { courseId: string; code: string; title: string }) {
  const [state, action] = useActionState(duplicateCourse.bind(null, courseId), null);
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-3">
      {state && !state.ok && !state.error.fieldErrors && <Alert kind="error">{state.error.message}</Alert>}
      <Field label="Clave del curso nuevo" htmlFor="dup-code" error={fe.code} required><input id="dup-code" name="code" defaultValue={`${code}-2`} className="input uppercase" /></Field>
      <Field label="Nombre" htmlFor="dup-title" error={fe.title} required><input id="dup-title" name="title" defaultValue={`${title} (copia)`} className="input" /></Field>
      <div className="flex justify-end"><SubmitButton pendingText="Duplicando…">Duplicar</SubmitButton></div>
    </form>
  );
}
