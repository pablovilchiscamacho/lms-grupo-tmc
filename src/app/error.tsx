"use client";
import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/** Error inesperado: mensaje claro para el usuario; el detalle técnico queda en los logs del servidor (§66). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <AlertTriangle className="size-10 text-amber-500" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Ocurrió un problema al cargar esta página</h1>
      <p className="mt-2 text-sm text-slate-500">Inténtalo de nuevo. Si vuelve a pasar, avisa a tu administrador{error.digest ? <> con este código: <code className="font-mono">{error.digest}</code></> : null}.</p>
      <div className="mt-6 flex gap-2">
        <button className="btn-primary" onClick={reset}>Reintentar</button>
        <Link href="/" className="btn-secondary">Ir al inicio</Link>
      </div>
    </main>
  );
}
