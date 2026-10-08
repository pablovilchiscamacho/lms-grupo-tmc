import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { REPORTS } from "@/features/reports/catalog";
import { REPORT_ICONS } from "@/features/reports/ui/icons";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportsPage() {
  await requirePermission("reports.read", "/admin/reportes");
  return (
    <>
      <PageHeader title="Reportes" description="Elige un reporte, ajusta los filtros y descárgalo en Excel, CSV o PDF. Solo incluye a las personas de tu alcance." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = REPORT_ICONS[r.icon];
          return (
            <li key={r.key}>
              <Link href={`/admin/reportes/${r.slug}`} className="card flex h-full items-start gap-3 p-4 hover:border-brand-300 hover:shadow-sm">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{r.title}</span>
                  <span className="mt-0.5 block text-sm text-slate-600">{r.description}</span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-slate-400" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
