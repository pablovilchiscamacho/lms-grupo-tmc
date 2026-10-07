import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { requirePermission, can } from "@/lib/auth/session";
import { getOrgOptions } from "@/features/org/queries";
import { OrgManager } from "@/features/org/org-manager";
import { PageHeader } from "@/components/ui";
import type { OrgTable } from "@/features/org/actions";

export const metadata: Metadata = { title: "Organización" };

const TABS: { key: OrgTable; label: string }[] = [
  { key: "companies", label: "Empresas" },
  { key: "branches", label: "Sucursales" },
  { key: "departments", label: "Departamentos" },
  { key: "positions", label: "Puestos" },
];

export default async function OrgPage({ searchParams }: PageProps<"/admin/organizacion">) {
  const ctx = await requirePermission(["org.read", "org.manage"], "/admin/organizacion");
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "companies") as OrgTable;
  const company = typeof sp.empresa === "string" ? sp.empresa : undefined;
  const org = await getOrgOptions({ includeInactive: true });
  const items = { companies: org.companies, branches: org.branches, departments: org.departments, positions: org.positions }[tab];
  const active = { ...org, companies: org.companies.filter((c) => c.is_active), departments: org.departments.filter((d) => d.is_active) };

  return (
    <>
      <PageHeader title="Organización" description="Empresas, sucursales, departamentos y puestos del grupo. Nada se borra: se desactiva." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1" aria-label="Secciones">
          {TABS.map((t) => (
            <Link key={t.key} href={`?tab=${t.key}${company ? `&empresa=${company}` : ""}`} aria-current={t.key === tab ? "page" : undefined}
              className={clsx("rounded-md px-3 py-1.5 text-sm font-medium", t.key === tab ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900")}>
              {t.label}
            </Link>
          ))}
        </nav>
        {tab !== "companies" && org.companies.length > 1 && (
          <form className="flex items-center gap-2">
            <input type="hidden" name="tab" value={tab} />
            <label htmlFor="empresa" className="text-sm text-slate-500">Empresa</label>
            <select id="empresa" name="empresa" defaultValue={company ?? ""} className="input w-auto">
              <option value="">Todas</option>
              {org.companies.map((c) => <option key={c.id} value={c.id}>{c.short_name}</option>)}
            </select>
            <button className="btn-secondary">Filtrar</button>
          </form>
        )}
      </div>
      <OrgManager table={tab} items={items as never} org={active} canManage={can(ctx, "org.manage")} filterCompany={company} />
    </>
  );
}
