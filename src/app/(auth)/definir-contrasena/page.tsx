import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { Alert } from "@/components/ui";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Definir contraseña" };

export default async function SetPasswordPage({ searchParams }: PageProps<"/definir-contrasena">) {
  const ctx = await requireUser({ allowPasswordChange: true });
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Define tu contraseña</h1>
      <p className="mt-1 text-sm text-slate-500">Hola, {ctx.profile.first_name}. Elige una contraseña que solo tú conozcas.</p>
      {(sp.motivo === "obligatorio" || ctx.profile.must_change_password) && (
        <div className="mt-5"><Alert kind="info">Por seguridad, debes cambiar la contraseña temporal antes de continuar.</Alert></div>
      )}
      <SetPasswordForm />
    </>
  );
}
