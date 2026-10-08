"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { Alert, Field } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { revokeCertificate, saveCertificateSettings } from "../actions";

/** Botón + ventana para revocar una constancia con motivo. */
export function RevokeButton({ id, number, holder }: { id: string; number: string; holder: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" onClick={() => setOpen(true)} aria-label={`Revocar ${number}`} title="Revocar">
        <Ban className="size-4" />
      </button>
      <Modal open={open} onOpenChange={setOpen} title={`Revocar ${number}`}
        description={`La constancia de ${holder} dejará de ser válida: al escanear su QR se verá como revocada. No se puede deshacer.`}>
        <div className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Motivo" htmlFor="rev-reason" required>
            <textarea id="rev-reason" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Se detectó que otra persona presentó el examen" />
          </Field>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn-danger" disabled={pending || reason.trim().length < 5} onClick={() => start(async () => {
              const r = await revokeCertificate(id, reason);
              if (!r.ok) return setError(r.error.fieldErrors?.reason ?? r.error.message);
              setOpen(false); router.refresh();
            })}>{pending && <Loader2 className="size-4 animate-spin" />} Revocar constancia</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Firma que llevan las constancias nuevas. */
export function SignerForm({ initial }: { initial: { signer_name?: string; signer_title?: string } }) {
  const [name, setName] = useState(initial.signer_name ?? "");
  const [title, setTitle] = useState(initial.signer_title ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {msg && <Alert kind={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
      <Field label="Nombre de quien firma" htmlFor="sg-name" hint="Si lo dejas vacío dirá «Coordinación de Capacitación».">
        <input id="sg-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej. Lic. María Fernanda Ruiz" />
      </Field>
      <Field label="Cargo" htmlFor="sg-title">
        <input id="sg-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Ej. Gerente de Capacitación" />
      </Field>
      <div className="flex justify-end">
        <button className="btn-secondary" disabled={pending} onClick={() => start(async () => {
          const r = await saveCertificateSettings({ signer_name: name, signer_title: title });
          setMsg(r.ok ? { ok: true, text: r.message ?? "Guardado." } : { ok: false, text: r.error.message });
        })}>{pending && <Loader2 className="size-4 animate-spin" />} Guardar firma</button>
      </div>
    </div>
  );
}
