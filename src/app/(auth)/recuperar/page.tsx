import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Alert } from "@/components/ui";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Restablecer contraseña" };
export const dynamic = "force-dynamic";

/** Mientras el envío de correos no esté encendido (dominio pendiente con IT), el enlace por correo no llegaría:
 *  se indica acudir a Capital Humano, que asigna la contraseña desde la ficha de la persona. */
export default async function RecoverPage() {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "email").is("company_id", null).maybeSingle();
  if ((data?.value as { enabled?: boolean } | undefined)?.enabled) return <RecoverForm />;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">¿Olvidaste tu contraseña?</h1>
      <div className="mt-6 space-y-4">
        <Alert kind="info">Acude a <strong>Capital Humano</strong> de tu empresa: te asignan una contraseña nueva al momento.</Alert>
        <Link href="/entrar" className="btn-secondary w-full">Volver a entrar</Link>
      </div>
    </>
  );
}
