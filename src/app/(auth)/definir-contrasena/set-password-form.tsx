"use client";
import { useActionState } from "react";
import { setPassword } from "@/features/auth/actions";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";

export function SetPasswordForm() {
  const [state, action] = useActionState(setPassword, null);
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {state && !state.ok && !state.error.fieldErrors && <Alert kind="error">{state.error.message}</Alert>}
      <Field label="Nueva contraseña" htmlFor="password" error={fe.password} hint="Mínimo 10 caracteres, con letras y números.">
        <input id="password" name="password" type="password" className="input" autoComplete="new-password" required aria-invalid={!!fe.password} />
      </Field>
      <Field label="Confirmar contraseña" htmlFor="confirm" error={fe.confirm}>
        <input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" required aria-invalid={!!fe.confirm} />
      </Field>
      <SubmitButton className="btn-primary w-full py-2.5" pendingText="Guardando…">Guardar y continuar</SubmitButton>
    </form>
  );
}
