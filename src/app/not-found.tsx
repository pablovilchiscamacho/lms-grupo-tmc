import Link from "next/link";
import { SearchX } from "lucide-react";
import { BrandMark } from "@/components/ui";

/** 404 en español, sin detalles técnicos. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <BrandMark className="mb-8 text-brand-900" />
      <SearchX className="size-10 text-slate-400" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-slate-900">No encontramos esta página</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">El enlace puede estar incompleto o la información ya no existe. Si llegaste aquí desde un correo o una constancia, revisa que la dirección esté completa.</p>
      <Link href="/" className="btn-primary mt-6">Ir al inicio</Link>
    </main>
  );
}
