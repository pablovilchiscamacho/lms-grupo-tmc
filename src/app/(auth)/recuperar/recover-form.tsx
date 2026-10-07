"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/features/auth/actions";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";

export function RecoverForm() {
  const [state, action] = useActionState(requestPasswordReset, null);
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Restablecer contraseña</h1>
      <p className="mt-1 text-sm text-slate-500">Te enviaremos un enlace seguro a tu correo corporativo.</p>
      {state?.ok ? (
        <div className="mt-6 space-y-4">
          <Alert kind="success">{state.message}</Alert>
          <Link href="/entrar" className="btn-secondary w-full">Volver a entrar</Link>
        </div>
      ) : (
        <form action={action} className="mt-6 space-y-4" noValidate>
          {state && !state.ok && !state.error.fieldErrors && <Alert kind="error">{state.error.message}</Alert>}
          <Field label="Correo corporativo" htmlFor="email" error={fe.email}>
            <input id="email" name="email" type="email" className="input" autoComplete="email" autoFocus required aria-invalid={!!fe.email} />
          </Field>
          <SubmitButton className="btn-primary w-full py-2.5" pendingText="Enviando…">Enviar enlace</SubmitButton>
          <Alert kind="info">¿No tienes correo corporativo? Pide a tu administrador o a Recursos Humanos que restablezca tu contraseña.</Alert>
          <p className="text-center text-sm"><Link href="/entrar" className="font-medium text-brand-700 hover:underline">Volver</Link></p>
        </form>
      )}
    </>
  );
}
