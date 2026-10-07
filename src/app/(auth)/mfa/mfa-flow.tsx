"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { logMfa } from "@/features/auth/actions";
import { Alert, Field } from "@/components/ui";

type Mode = { kind: "loading" } | { kind: "enroll"; factorId: string; qr: string; secret: string } | { kind: "verify"; factorId: string } | { kind: "error"; message: string };

export function MfaFlow({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setMode({ kind: "error", message: "No pudimos consultar tu verificación en dos pasos. Recarga la página." });
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setMode({ kind: "verify", factorId: verified.id });
      // Limpia intentos de alta que no se terminaron.
      for (const f of data.all.filter((f) => f.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Grupo TMC ${new Date().toISOString().slice(0, 10)}` });
      if (enrolled.error) return setMode({ kind: "error", message: "No pudimos iniciar la configuración. Recarga la página." });
      setMode({ kind: "enroll", factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind !== "enroll" && mode.kind !== "verify") return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mode.factorId, code: code.trim() });
    if (error) {
      setBusy(false);
      setError("El código no es correcto o ya expiró. Escribe el código que aparece ahora en tu app.");
      return;
    }
    await logMfa(mode.kind === "enroll" ? "enrolled" : "verified");
    router.replace(next);
    router.refresh();
  }

  if (mode.kind === "loading") return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Cargando…</p>;
  if (mode.kind === "error") return <Alert kind="error">{mode.message}</Alert>;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Verificación en dos pasos</h1>
      {mode.kind === "enroll" ? (
        <div className="mt-2 space-y-3 text-sm text-slate-600">
          <p>Tu rol administrativo requiere un segundo factor. Es una sola vez por dispositivo:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Instala Google Authenticator o Microsoft Authenticator en tu celular.</li>
            <li>Escanea este código QR con la app.</li>
            <li>Escribe el código de 6 dígitos que te muestra.</li>
          </ol>
          {/* El QR es un SVG generado por Supabase (data URL). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mode.qr} alt="Código QR para configurar la app de autenticación" className="mx-auto size-44 rounded-lg border border-slate-200 bg-white p-2" />
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">¿No puedes escanear? Escribe esta clave</summary>
            <code className="mt-1 block break-all rounded bg-slate-100 p-2 font-mono">{mode.secret}</code>
          </details>
        </div>
      ) : (
        <p className="mt-1 text-sm text-slate-500">Escribe el código de 6 dígitos de tu app de autenticación.</p>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Código" htmlFor="code">
          <input id="code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" className="input text-center text-lg tracking-[0.5em]" autoFocus required />
        </Field>
        <button className="btn-primary w-full py-2.5" disabled={busy || code.length !== 6}>
          {busy && <Loader2 className="size-4 animate-spin" />} Verificar
        </button>
      </form>
    </>
  );
}
