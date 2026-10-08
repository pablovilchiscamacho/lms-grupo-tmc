import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { BrandMark } from "@/components/ui";

export const metadata: Metadata = { title: "Verificar constancia" };

/** Verificación manual: para quien tiene la constancia impresa y no puede escanear el QR. */
export default async function VerifyForm({ searchParams }: PageProps<"/verify/certificate">) {
  const sp = await searchParams;
  const code = typeof sp.codigo === "string" ? sp.codigo.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (code) redirect(`/verify/certificate/${code}`);
  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-10">
      <BrandMark className="mb-8 text-brand-900" />
      <form className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <BadgeCheck className="size-8 text-brand-600" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Verificar una constancia</h1>
        <p className="mt-1 text-sm text-slate-600">Escribe el código de verificación que aparece debajo del QR de la constancia.</p>
        <label htmlFor="codigo" className="mt-4 block text-sm font-medium text-slate-700">Código de verificación</label>
        <input id="codigo" name="codigo" required autoComplete="off" placeholder="ABCD-EFGH-JKLM-NPQR" className="input mt-1 font-mono uppercase tracking-wider" />
        <button className="btn-primary mt-4 w-full">Verificar</button>
      </form>
    </main>
  );
}
