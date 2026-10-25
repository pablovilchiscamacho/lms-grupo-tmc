"use client";
import clsx from "clsx";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { createContext, startTransition, useContext, useEffect, useRef, useState, type FormHTMLAttributes, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";

const KeepPending = createContext(false);

/**
 * Formulario que NO borra lo capturado al enviar. React 19 limpia los campos de un <form action={...}> cada vez que se
 * envía, aunque el servidor responda con error: la persona tenía que capturar todo otra vez. Aquí el envío se hace
 * en una transición y los campos solo se limpian si la respuesta fue correcta (state.ok).
 */
export function KeepForm({ action, state, children, ...rest }: Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit"> & {
  action: (fd: FormData) => void; state?: { ok: boolean } | null; children: ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  // «Enviando» mientras la respuesta (state) siga siendo la misma que había al enviar.
  const [sentWith, setSentWith] = useState<{ s: unknown } | null>(null);
  const pending = sentWith !== null && sentWith.s === state;
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form {...rest} ref={ref} onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
      setSentWith({ s: state });
      startTransition(() => action(fd));
    }}>
      <KeepPending.Provider value={pending}>{children}</KeepPending.Provider>
    </form>
  );
}

export function SubmitButton({ children, className = "btn-primary", pendingText }: { children: ReactNode; className?: string; pendingText?: string }) {
  const status = useFormStatus();
  const kept = useContext(KeepPending);
  const pending = status.pending || kept;
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

export function Modal({ open, onOpenChange, title, description, children, wide }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px]" />
        <D.Content
          className={clsx(
            "fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl",
            wide ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-base font-semibold text-slate-900">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-slate-500">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close className="btn-ghost -m-1 p-1.5" aria-label="Cerrar">
              <X className="size-4" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
