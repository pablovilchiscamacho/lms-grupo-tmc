import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { listQuestions, listQuestionCategories } from "@/features/exams/queries";
import { BankList } from "@/features/exams/ui/bank-list";
import { DIFFICULTY, SHORT_TYPE } from "@/features/exams/types";
import { PageHeader } from "@/components/ui";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Banco de preguntas" };

export default async function BankPage({ searchParams }: PageProps<"/admin/banco-preguntas">) {
  const ctx = await requirePermission("questions.read", "/admin/banco-preguntas");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const [{ rows, total, page }, categories] = await Promise.all([
    listQuestions({ q: s("q"), type: s("tipo"), difficulty: s("dificultad"), category: s("categoria"), page: Number(s("pagina")) || 1 }),
    listQuestionCategories(),
  ]);
  return (
    <>
      <PageHeader title="Banco de preguntas" description={`${total} pregunta${total === 1 ? "" : "s"}. Se reutilizan en varios exámenes o se sacan al azar.`} />
      <form className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5" role="search">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" aria-hidden />
          <input name="q" defaultValue={s("q")} placeholder="Buscar texto o tema…" className="input pl-9" aria-label="Buscar" />
        </div>
        <select name="tipo" defaultValue={s("tipo")} className="input" aria-label="Tipo"><option value="">Todos los tipos</option>{Object.entries(SHORT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="dificultad" defaultValue={s("dificultad")} className="input" aria-label="Dificultad"><option value="">Cualquier dificultad</option>{Object.entries(DIFFICULTY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="categoria" defaultValue={s("categoria")} className="input" aria-label="Categoría"><option value="">Todas las categorías</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5 lg:justify-end"><Link href="/admin/banco-preguntas" className="btn-ghost">Limpiar</Link><button className="btn-secondary">Filtrar</button></div>
      </form>
      <BankList rows={rows} categories={categories} canWrite={can(ctx, "questions.write")} />
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 25))} params={sp} />
    </>
  );
}
