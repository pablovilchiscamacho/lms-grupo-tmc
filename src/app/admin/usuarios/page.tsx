import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Upload, Search, Users } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { listUsers, listRoles, PAGE_SIZE, type UserFilters } from "@/features/users/queries";
import { getOrgOptions } from "@/features/org/queries";
import { fmtRelative, STATUS_LABEL } from "@/lib/format";
import { Badge, EmptyState, PageHeader, STATUS_TONE } from "@/components/ui";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/usuarios">) {
  const ctx = await requirePermission("users.read", "/admin/usuarios");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters: UserFilters = {
    q: s("q"), company: s("empresa"), branch: s("sucursal"), department: s("departamento"), position: s("puesto"),
    status: s("estado"), role: s("rol"), sin: s("sin"), page: Number(s("pagina") ?? 1) || 1,
  };
  const [{ rows, total, page }, org, roles] = await Promise.all([listUsers(filters), getOrgOptions(), listRoles()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const companyFilter = filters.company;
  const by = <T extends { company_id: string }>(list: T[]) => (companyFilter ? list.filter((x) => x.company_id === companyFilter) : list);

  return (
    <>
      <PageHeader
        title="Usuarios"
        description={`${total.toLocaleString("es-MX")} usuario${total === 1 ? "" : "s"} en tu alcance`}
        actions={<>
          {can(ctx, "users.import") && <Link href="/admin/usuarios/importar" className="btn-secondary"><Upload className="size-4" /> Importar</Link>}
          {can(ctx, "users.create") && <Link href="/admin/usuarios/nuevo" className="btn-primary"><Plus className="size-4" /> Nuevo usuario</Link>}
        </>}
      />

      <form className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7" role="search" aria-label="Filtrar usuarios">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" aria-hidden />
          <label htmlFor="q" className="sr-only">Buscar</label>
          <input id="q" name="q" defaultValue={filters.q} placeholder="Nombre, número, correo…" className="input pl-9" />
        </div>
        <Select name="empresa" label="Empresa" value={filters.company} options={org.companies.map((c) => [c.id, c.short_name])} />
        <Select name="sucursal" label="Sucursal" value={filters.branch} options={by(org.branches).map((b) => [b.id, b.name])} />
        <Select name="departamento" label="Departamento" value={filters.department} options={by(org.departments).map((d) => [d.id, d.name])} />
        <Select name="estado" label="Estado" value={filters.status} options={Object.entries(STATUS_LABEL)} />
        <Select name="rol" label="Rol" value={filters.role} options={roles.map((r) => [r.key, r.name])} />
        {filters.sin && <input type="hidden" name="sin" value={filters.sin} />}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4 2xl:col-span-7 lg:justify-end">
          {filters.sin && <Badge tone="amber">Filtro: sin {filters.sin}</Badge>}
          <Link href="/admin/usuarios" className="btn-ghost">Limpiar</Link>
          <button className="btn-secondary">Aplicar filtros</button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={<Users className="size-8" />} title="No hay usuarios con esos filtros" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Nombre</th><th className="th">Núm.</th><th className="th">Empresa</th>
                <th className="th">Departamento</th><th className="th">Puesto</th><th className="th">Estado</th><th className="th">Último acceso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="td">
                    <Link href={`/admin/usuarios/${u.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{u.full_name}</Link>
                    <div className="text-xs text-slate-500">{u.email ?? (u.username ? `@${u.username}` : "Sin correo")}</div>
                  </td>
                  <td className="td tabular-nums">{u.employee_number ?? "—"}</td>
                  <td className="td">{u.company?.short_name ?? "—"}{u.branch ? <span className="text-slate-400"> · {u.branch.name}</span> : null}</td>
                  <td className="td">{u.department?.name ?? <span className="text-amber-600">Sin departamento</span>}</td>
                  <td className="td">{u.position?.name ?? "—"}</td>
                  <td className="td"><Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge></td>
                  <td className="td text-slate-500">{u.last_login_at ? fmtRelative(u.last_login_at) : "Nunca"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={pages} params={sp} />
    </>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <div>
      <label htmlFor={name} className="sr-only">{label}</label>
      <select id={name} name={name} defaultValue={value ?? ""} className="input">
        <option value="">{label}: todos</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
