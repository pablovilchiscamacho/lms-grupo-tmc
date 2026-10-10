"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, Field } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { PrivacyText } from "../render";
import { publishPrivacy, savePrivacyDraft } from "../actions";

const PLACEHOLDER = /\[[A-ZÁÉÍÓÚÑ ]{3,}\]/g;

export function NoticeEditor({ companyId, draftId, title: t0, body: b0, hasPublished }: { companyId: string | null; draftId: string | null; title: string; body: string; hasPublished: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(t0);
  const [body, setBody] = useState(b0);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const missing = [...new Set(body.match(PLACEHOLDER) ?? [])];
  const dirty = title !== t0 || body !== b0;

  const save = (then?: (id: string) => Promise<void>) => start(async () => {
    const r = await savePrivacyDraft({ company_id: companyId, title, body });
    if (!r.ok) { setMsg({ ok: false, text: Object.values(r.error.fieldErrors ?? {})[0] ?? r.error.message }); return; }
    if (then) await then(r.data!.id);
    else { setMsg({ ok: true, text: r.message ?? "Guardado." }); router.refresh(); }
  });
  const publish = () => save(async (id) => {
    const r = await publishPrivacy(id);
    setConfirm(false);
    setMsg(r.ok ? { ok: true, text: r.message ?? "Publicado." } : { ok: false, text: r.error.message });
    if (r.ok) router.refresh();
  });

  if (!open) return <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>{draftId ? "Seguir editando el borrador" : hasPublished ? "Hacer una nueva versión" : "Redactar aviso"}</button>;

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
      {missing.length > 0 && <Alert kind="warning">Antes de publicar, completa: {missing.join(", ")}.</Alert>}
      <Field label="Título" htmlFor={`t-${companyId ?? "g"}`}>
        <input id={`t-${companyId ?? "g"}`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="flex gap-2 text-sm">
        <button type="button" className={preview ? "btn-ghost" : "btn-secondary"} onClick={() => setPreview(false)}>Editar</button>
        <button type="button" className={preview ? "btn-secondary" : "btn-ghost"} onClick={() => setPreview(true)}>Vista previa</button>
      </div>
      {preview ? <div className="rounded-lg border border-slate-200 p-4"><PrivacyText body={body} /></div> : (
        <Field label="Texto" htmlFor={`b-${companyId ?? "g"}`} hint="«## Título» crea un subtítulo y «- texto» una viñeta. {{empresa}} y {{fecha}} se llenan solos.">
          <textarea id={`b-${companyId ?? "g"}`} className="input min-h-96 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" disabled={pending || (!dirty && Boolean(draftId))} onClick={() => save()}>{pending && <Loader2 className="size-4 animate-spin" />} Guardar borrador</button>
        <button type="button" className="btn-primary" disabled={pending || missing.length > 0} onClick={() => setConfirm(true)}>Publicar</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cerrar</button>
      </div>
      <Modal open={confirm} onOpenChange={setConfirm} title="¿Publicar el aviso?"
        description={hasPublished ? "Reemplaza al aviso vigente. A todas las personas de esta empresa se les pedirá aceptarlo otra vez al ingresar." : "A todas las personas a las que aplica se les pedirá aceptarlo al ingresar."}>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={pending} onClick={publish}>{pending && <Loader2 className="size-4 animate-spin" />} Publicar</button>
        </div>
      </Modal>
    </div>
  );
}
