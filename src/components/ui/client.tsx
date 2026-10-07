"use client";
import clsx from "clsx";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";

export function SubmitButton({ children, className = "btn-primary", pendingText }: { children: ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
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
