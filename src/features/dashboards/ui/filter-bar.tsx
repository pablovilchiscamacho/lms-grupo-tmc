import Link from "next/link";
import { Search } from "lucide-react";
import type { OrgOptions } from "@/features/org/queries";

type Field = "q" | "empresa" | "sucursal" | "departamento" | "puesto" | "jefe" | "curso" | "semaforo" | "estado" | "fechas";

/** Filtros de los tableros por URL (GET), para que cada vista se pueda compartir o guardar como favorito. */
export function FilterBar({ action, sp, org, courses = [], managers = [], fields, keep = [], statusOptions, dateLabel = "Asignados" }: {
  action: string; sp: Record<string, string | string[] | undefined>; org: OrgOptions;
  courses?: { id: string; code: string; title: string }[]; managers?: { id: string; full_name: string }[];
  fields: Field[]; keep?: string[];
  /** Opciones propias de «Estado» (reportes); sin ellas se usa la situación de los tableros. */
  statusOptions?: [string, string][]; dateLabel?: string;
}) {
  const v = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const company = v("empresa");
  const by = <T extends { company_id: string }>(l: T[]) => (company ? l.filter((x) => x.company_id === company) : l);
  // Sin empresa elegida, "Querétaro" o "Operaciones" se repiten: se antepone la empresa.
  const co = new Map(org.companies.map((c) => [c.id, c.short_name]));
  const label = (x: { company_id: string; name: string }) => (company || org.companies.length < 2 ? x.name : `${co.get(x.company_id)} · ${x.name}`);
  const opts = <T extends { id: string; company_id: string; name: string }>(l: T[]) =>
    by(l).map((x) => [x.id, label(x)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1], "es"));
  const has = (f: Field) => fields.includes(f);
  const active = fields.some((f) => (f === "fechas" ? v("desde") || v("hasta") : v(f)));
  return (
    <form action={action} className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Filtros">
      {keep.map((k) => v(k) && <input key={k} type="hidden" name={k} value={v(k)} />)}
      {has("q") && (
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" aria-hidden />
          <label htmlFor="f-q" className="sr-only">Buscar persona</label>
          <input id="f-q" name="q" defaultValue={v("q")} placeholder="Nombre o número de empleado…" className="input pl-9" />
        </div>
      )}
      {has("empresa") && org.companies.length > 1 && <Select name="empresa" label="Empresa" value={company} options={org.companies.map((c) => [c.id, c.short_name])} />}
      {has("sucursal") && <Select name="sucursal" label="Sucursal" value={v("sucursal")} options={opts(org.branches)} />}
      {has("departamento") && <Select name="departamento" label="Departamento" value={v("departamento")} options={opts(org.departments)} />}
      {has("puesto") && <Select name="puesto" label="Puesto" value={v("puesto")} options={opts(org.positions)} />}
      {has("jefe") && managers.length > 0 && <Select name="jefe" label="Jefe" value={v("jefe")} options={managers.map((m) => [m.id, m.full_name])} />}
      {has("curso") && <Select name="curso" label="Curso" value={v("curso")} options={courses.map((c) => [c.id, `${c.title} · ${c.code}`])} />}
      {has("semaforo") && <Select name="semaforo" label="Semáforo" value={v("semaforo")} options={[["verde", "🟢 90 % o más"], ["amarillo", "🟡 70 a 89 %"], ["rojo", "🔴 Menos de 70 %"], ["sin-cursos", "Sin cursos asignados"]]} />}
      {has("estado") && (statusOptions
        ? <Select name="estado" label="Estado" value={v("estado")} options={statusOptions} />
        : <Select name="estado" label="Situación" value={v("estado")} options={[["vencidos", "Con cursos vencidos"], ["por-vencer", "Vencen esta semana"], ["reprobados", "Con cursos reprobados"]]} />)}
      {has("fechas") && (
        <div className="grid grid-cols-2 gap-2 sm:col-span-2">
          <label className="text-xs text-slate-500">{dateLabel} desde<input type="date" name="desde" defaultValue={v("desde")} className="input mt-0.5" /></label>
          <label className="text-xs text-slate-500">hasta<input type="date" name="hasta" defaultValue={v("hasta")} className="input mt-0.5" /></label>
        </div>
      )}
      <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-4">
        {active && <Link href={`${action}${keep.length && v(keep[0]) ? `?${keep[0]}=${v(keep[0])}` : ""}`} className="btn-ghost">Limpiar</Link>}
        <button className="btn-secondary">Aplicar filtros</button>
      </div>
    </form>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <div>
      <label htmlFor={`f-${name}`} className="sr-only">{label}</label>
      <select id={`f-${name}`} name={name} defaultValue={value ?? ""} className="input">
        <option value="">{label}: todos</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
