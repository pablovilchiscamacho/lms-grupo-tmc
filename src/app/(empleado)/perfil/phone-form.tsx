"use client";
import { useActionState } from "react";
import { updateMyPhone } from "@/features/profile/actions";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";

export function PhoneForm({ phone }: { phone: string }) {
  const [state, action] = useActionState(updateMyPhone, null);
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-3">
      {state?.ok && <Alert kind="success">{state.message}</Alert>}
      {state && !state.ok && !state.error.fieldErrors && <Alert kind="error">{state.error.message}</Alert>}
      <Field label="Teléfono" htmlFor="phone" error={fe.phone}>
        <input id="phone" name="phone" defaultValue={phone} className="input" inputMode="tel" autoComplete="tel" aria-invalid={!!fe.phone} />
      </Field>
      <SubmitButton className="btn-secondary w-full">Guardar</SubmitButton>
    </form>
  );
}
