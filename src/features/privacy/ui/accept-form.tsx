"use client";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui";
import { acceptPrivacy } from "../actions";

export function AcceptForm({ id }: { id: string }) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const accept = () => start(async () => {
    const r = await acceptPrivacy(id);
    if (r && !r.ok) setError(r.error.code === "VALIDATION" ? "El aviso se actualizó. Recarga la página para leer la versión vigente." : r.error.message);
  });
  return (
    <div className="mt-5 space-y-4">
      {error && <Alert kind="error">{error}</Alert>}
      <label className="flex items-start gap-3 text-sm text-slate-800">
        <input type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>He leído el aviso de privacidad y acepto el tratamiento de mis datos personales en los términos descritos.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={!checked || pending} onClick={accept}>
          {pending && <Loader2 className="size-4 animate-spin" />} Aceptar y continuar
        </button>
        <a href="/salir?motivo=privacidad" className="btn-ghost">No acepto</a>
      </div>
      <p className="text-xs text-slate-500">Si no aceptas, no podrás usar la plataforma. Para dudas, acude a Capital Humano.</p>
    </div>
  );
}
