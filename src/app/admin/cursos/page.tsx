import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, HardDrive, Plus, Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { listCourses, getStorageUsage } from "@/features/courses/queries";
import { COURSE_STATUS, fmtBytes, fmtRelative } from "@/lib/format";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Cursos" };

export default async function CoursesPage({ searchParams }: PageProps<"/admin/cursos">) {
  const ctx = await requirePermission("courses.read", "/admin/cursos");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.estado === "string" ? sp.estado : "";
  const [courses, usage] = await Promise.all([listCourses({ q, status }), getStorageUsage().catch(() => null)]);
  const usedPct = usage ? (usage.used_bytes / (usage.quota_gb * 1024 ** 3)) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Cursos"
        description="Crea un curso, sube sus presentaciones y videos, publícalo y asígnalo."
        actions={can(ctx, "courses.create") ? <Link href="/admin/cursos/nuevo" className="btn-primary"><Plus className="size-4" /> Nuevo curso</Link> : undefined}
      />
      {sp.borrado && <div className="mb-4"><Alert kind="success">El curso se borró.</Alert></div>}

      {usage && (
        <Link href="/admin/cursos/espacio" className="card mb-4 flex items-center gap-4 p-4 hover:bg-slate-50">
          <HardDrive className="size-5 text-slate-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-slate-800">Espacio usado: {fmtBytes(usage.used_bytes)} de {usage.quota_gb} GB</span>
              <span className="text-xs text-slate-500">{usage.files} archivos · ver detalle</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full ${usedPct >= usage.warn_pct ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${Math.max(usedPct, 0.5)}%` }} />
            </div>
          </div>
        </Link>
      )}

      <form className="card mb-4 flex flex-col gap-3 p-3 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" aria-hidden />
          <label htmlFor="q" className="sr-only">Buscar</label>
          <input id="q" name="q" defaultValue={q} placeholder="Buscar por clave o nombre…" className="input pl-9" />
        </div>
        <label htmlFor="estado" className="sr-only">Estado</label>
        <select id="estado" name="estado" defaultValue={status} className="input sm:w-48">
          <option value="">Activos (sin archivados)</option>
          {Object.entries(COURSE_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn-secondary">Buscar</button>
      </form>

      {courses.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-8" />} title={q || status ? "No hay cursos con ese filtro" : "Todavía no hay cursos"}
          action={can(ctx, "courses.create") && !q ? <Link href="/admin/cursos/nuevo" className="btn-primary"><Plus className="size-4" /> Crear el primero</Link> : undefined}>
          {!q && !status ? "Empieza con el asistente: datos del curso, contenido, examen y publicar." : undefined}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr><th className="th">Curso</th><th className="th">Estado</th><th className="th">Versión</th><th className="th">Empresa</th><th className="th">Asignados</th><th className="th">Actualizado</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {courses.map((c) => {
                const pub = c.versions.find((v) => v.status === "published");
                const draft = c.versions.find((v) => v.status === "draft" || v.status === "review");
                const [label, tone] = COURSE_STATUS[c.status] ?? [c.status, "slate"];
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="td">
                      <Link href={`/admin/cursos/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{c.title}</Link>
                      <div className="text-xs text-slate-500">{c.code}</div>
                    </td>
                    <td className="td"><Badge tone={tone}>{label}</Badge></td>
                    <td className="td text-sm">
                      {pub ? `v${pub.version_number}` : "—"}
                      {draft && pub && <span className="ml-1 text-xs text-amber-700">(v{draft.version_number} en edición)</span>}
                    </td>
                    <td className="td">{c.owner_company?.short_name ?? "Todo el grupo"}</td>
                    <td className="td tabular-nums">{c.enrollments?.[0]?.count ?? 0}</td>
                    <td className="td text-slate-500">{fmtRelative(c.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
