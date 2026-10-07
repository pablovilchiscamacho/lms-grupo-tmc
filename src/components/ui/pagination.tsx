import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Paginación por URL (?pagina=N) que conserva los filtros actuales. */
export function Pagination({ page, pages, params, param = "pagina" }: {
  page: number; pages: number; params: Record<string, string | string[] | undefined>; param?: string;
}) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v && k !== param) usp.set(k, v);
    usp.set(param, String(p));
    return `?${usp.toString()}`;
  };
  return (
    <nav aria-label="Paginación" className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>Página {page} de {pages}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link href={href(page - 1)} className="btn-secondary"><ChevronLeft className="size-4" /> Anterior</Link>
          : <span className="btn-secondary pointer-events-none opacity-40"><ChevronLeft className="size-4" /> Anterior</span>}
        {page < pages ? <Link href={href(page + 1)} className="btn-secondary">Siguiente <ChevronRight className="size-4" /></Link>
          : <span className="btn-secondary pointer-events-none opacity-40">Siguiente <ChevronRight className="size-4" /></span>}
      </div>
    </nav>
  );
}
