"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn } from "@/features/auth/actions";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, null);
  const [identifier, setIdentifier] = useState(""); // controlado: no se borra si la contraseña es incorrecta
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state && !state.ok && !state.error.fieldErrors && <Alert kind="error">{state.error.message}</Alert>}
      <Field label="Correo o número de empleado" htmlFor="identifier" error={fe.identifier}>
        <input id="identifier" name="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="input" autoComplete="username" autoFocus required
          aria-invalid={!!fe.identifier} aria-describedby={fe.identifier ? "identifier-error" : undefined} />
      </Field>
      <Field label="Contraseña" htmlFor="password" error={fe.password}>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required
          aria-invalid={!!fe.password} aria-describedby={fe.password ? "password-error" : undefined} />
      </Field>
      <SubmitButton className="btn-primary w-full py-2.5" pendingText="Entrando…">Entrar</SubmitButton>
      <p className="text-center text-sm">
        <Link href="/recuperar" className="font-medium text-brand-700 hover:underline">Olvidé mi contraseña</Link>
      </p>
    </form>
  );
}
