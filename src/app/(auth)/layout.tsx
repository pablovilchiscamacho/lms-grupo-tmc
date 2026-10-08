import { BrandMark } from "@/components/ui";
import { GraduationCap, ShieldCheck, LineChart } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-900 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(200,162,74,0.18),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(53,102,167,0.45),transparent_50%)]" aria-hidden />
        <span className="relative inline-flex self-start rounded-xl bg-white px-5 py-4 shadow-sm"><BrandMark size="lg" className="text-brand-900" /></span>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Capacitación que se puede demostrar.</h2>
          <p className="mt-3 text-brand-200">Cursos, evaluaciones y certificaciones del personal de Grupo TMC, con trazabilidad completa.</p>
          <ul className="mt-8 space-y-3 text-sm text-brand-100">
            <li className="flex items-center gap-2.5"><GraduationCap className="size-4 text-accent-500" aria-hidden /> Tus cursos asignados y tu avance en un solo lugar</li>
            <li className="flex items-center gap-2.5"><LineChart className="size-4 text-accent-500" aria-hidden /> Seguimiento de cumplimiento por área</li>
            <li className="flex items-center gap-2.5"><ShieldCheck className="size-4 text-accent-500" aria-hidden /> Historial y certificados verificables</li>
          </ul>
        </div>
        <p className="relative text-xs text-brand-300">© {new Date().getFullYear()} Grupo TMC · EA Logística · TMC · TMCa</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <BrandMark size="lg" className="mb-8 text-brand-900 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
