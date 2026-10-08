import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileSpreadsheet, FileText, FileType2, Info } from "lucide-react";
import clsx from "clsx";
import { can, requirePermission } from "@/lib/auth/session";
import { getOrgOptions } from "@/features/org/queries";
import { filterOptions } from "@/features/dashboards/queries";
import { FilterBar } from "@/features/dashboards/ui/filter-bar";
import { reportBySlug } from "@/features/reports/catalog";
import { cellText } from "@/features/reports/format";
import { EXPORT_MAX, parseReportFilters, runReport } from "@/features/reports/queries";
import { PDF_MAX_ROWS } from "@/features/reports/export";
import { REPORT_ICONS } from "@/features/reports/ui/icons";
import { EmptyState, PageHeader } from "@/components/ui";
import { Pagination } from "@/components/ui/pagination";

const PREVIEW = 100;

export async function generateMetadata({ params }: PageProps<"/admin/reportes/[slug]">): Promise<Metadata> {
  return { title: reportBySlug((await params).slug)?.title ?? "Reporte" };
}

export default async function ReportPage({ params, searchParams }: PageProps<"/admin/reportes/[slug]">) {
  const { slug } = await params;
  const def = reportBySlug(slug);
  if (!def) notFound();
  const ctx = await requirePermission("reports.read", `/admin/reportes/${slug}`);
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.pagina === "string" ? sp.pagina : 1) || 1);
  const f = parseReportFilters(sp);
  const tz = ctx.profile.company.timezone;
  const [data, org, opts] = await Promise.all([runReport(def.key, f, PREVIEW, (page - 1) * PREVIEW), getOrgOptions(), filterOptions()]);
  const pages = Math.max(1, Math.ceil(data.total / PREVIEW));
  const canExport = can(ctx, "reports.export");
  const Icon = REPORT_ICONS[def.icon];

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "pagina") query.set(k, v);
  const href = (format: string) => { const q = new URLSearchParams(query); q.set("formato", format); return `/api/reports/${def.slug}?${q}`; };
  const right = (t: string) => ["int", "num", "pct", "hours"].includes(t);

  return (
    <div className="space-y-5">
      <Link href="/admin/reportes" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="size-4" /> Reportes</Link>
      <PageHeader
        title={def.title}
        description={<span className="flex items-center gap-2"><Icon className="size-4 text-brand-600" aria-hidden />{def.description}</span>}
        actions={canExport ? (
          <div className="flex flex-wrap gap-2">
            <a href={href("xlsx")} className="btn-primary"><FileSpreadsheet className="size-4" /> Excel</a>
            <a href={href("csv")} className="btn-secondary"><FileText className="size-4" /> CSV</a>
            <a href={href("pdf")} className="btn-secondary"><FileType2 className="size-4" /> PDF</a>
          </div>
        ) : undefined}
      />

      <FilterBar action={`/admin/reportes/${def.slug}`} sp={sp} org={org} courses={opts.courses} managers={opts.managers}
        fields={def.filters} statusOptions={def.status} dateLabel={def.dateLabel} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <p><strong className="text-slate-900">{data.total.toLocaleString("es-MX")}</strong> fila{data.total === 1 ? "" : "s"}{data.total > PREVIEW ? ` · vista previa de ${PREVIEW} por página` : ""}</p>
        {def.note && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Info className="size-3.5" aria-hidden /> {def.note}</p>}
      </div>
      {canExport && data.total > PDF_MAX_ROWS && (
        <p className="text-xs text-amber-700">El PDF incluye las primeras {PDF_MAX_ROWS.toLocaleString("es-MX")} filas; Excel y CSV, hasta {EXPORT_MAX.toLocaleString("es-MX")}.</p>
      )}

      {data.rows.length === 0 ? <EmptyState title="Sin resultados con estos filtros" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: `${Math.max(760, def.columns.length * 110)}px` }}>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>{def.columns.map((c) => <th key={c.key} className={clsx("th whitespace-nowrap", right(c.type) && "text-right")}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((r, i) => (
                <tr key={i}>
                  {def.columns.map((c) => (
                    <td key={c.key} className={clsx("td", right(c.type) && "text-right tabular-nums", c.key === "nombre" && "font-medium text-slate-900")}>
                      {cellText(r[c.key], c, tz) || <span className="text-slate-300">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={pages} params={sp} />
    </div>
  );
}
