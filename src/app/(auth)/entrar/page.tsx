import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

const MOTIVOS: Record<string, { kind: "info" | "warning"; text: string }> = {
  inactivo: { kind: "warning", text: "Tu cuenta no está activa. Si crees que es un error, contacta a tu administrador." },
  expirado: { kind: "warning", text: "El enlace expiró o ya se usó. Solicita uno nuevo." },
  salida: { kind: "info", text: "Cerraste sesión." },
  privacidad: { kind: "warning", text: "Para usar la plataforma es necesario aceptar el aviso de privacidad. Si tienes dudas, acude a Capital Humano." },
};

export default async function SignInPage({ searchParams }: PageProps<"/entrar">) {
  const sp = await searchParams;
  const motivo = MOTIVOS[String(sp.motivo ?? "")];
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Entrar</h1>
      <p className="mt-1 text-sm text-slate-500">Usa tu correo corporativo o tu número de empleado.</p>
      {motivo && <div className="mt-5"><Alert kind={motivo.kind}>{motivo.text}</Alert></div>}
      <SignInForm next={typeof sp.next === "string" ? sp.next : ""} />
      <p className="mt-6 text-center text-xs text-slate-500"><a href="/privacidad" className="hover:underline">Aviso de privacidad</a></p>
    </>
  );
}
