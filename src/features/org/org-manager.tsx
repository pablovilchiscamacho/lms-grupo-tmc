"use client";
import { useActionState, useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { Alert, Badge, EmptyState, Field } from "@/components/ui";
import { Modal, SubmitButton } from "@/components/ui/client";
import { saveOrgItem, setOrgItemActive, type OrgTable } from "./actions";
import type { OrgOptions } from "./queries";

type Item = Record<string, unknown> & { id: string; name: string; is_active: boolean };
type Col = { key: string; label: string; render?: (i: Item) => React.ReactNode };
type FieldDef = { name: string; label: string; type?: "text" | "select"; options?: (companyId: string) => [string, string][]; required?: boolean; hint?: string; onlyCreate?: boolean };

export function OrgManager({ table, items, org, canManage, filterCompany }: {
  table: OrgTable; items: Item[]; org: OrgOptions; canManage: boolean; filterCompany?: string;
}) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const companyName = (cid: unknown) => org.companies.find((c) => c.id === cid)?.short_name ?? "—";
  const deptName = (did: unknown) => org.departments.find((d) => d.id === did)?.name ?? "—";

  const cfg: Record<OrgTable, { title: string; cols: Col[]; fields: FieldDef[] }> = {
    companies: {
      title: "empresa",
      cols: [{ key: "name", label: "Nombre" }, { key: "short_name", label: "Abreviatura" }, { key: "legal_name", label: "Razón social" }, { key: "rfc", label: "RFC" }, { key: "timezone", label: "Zona horaria" }],
      fields: [
        { name: "name", label: "Nombre comercial", required: true }, { name: "short_name", label: "Abreviatura", required: true, hint: "Ej. EA, TMC, TMCa. Se usa en la importación." },
        { name: "legal_name", label: "Razón social" }, { name: "rfc", label: "RFC" },
        { name: "timezone", label: "Zona horaria", type: "select", required: true, options: () => TIMEZONES.map((t) => [t, t]) },
      ],
    },
    branches: {
      title: "sucursal",
      cols: [{ key: "name", label: "Sucursal" }, { key: "code", label: "Clave" }, { key: "company_id", label: "Empresa", render: (i) => companyName(i.company_id) }, { key: "city", label: "Ciudad" }, { key: "state", label: "Estado" }],
      fields: [
        { name: "company_id", label: "Empresa", type: "select", required: true, onlyCreate: true, options: () => org.companies.map((c) => [c.id, c.name]) },
        { name: "name", label: "Nombre", required: true }, { name: "code", label: "Clave", required: true, hint: "Ej. QRO, MTY, ZLO" },
        { name: "city", label: "Ciudad" }, { name: "state", label: "Estado" },
      ],
    },
    departments: {
      title: "departamento",
      cols: [{ key: "name", label: "Departamento" }, { key: "code", label: "Clave" }, { key: "company_id", label: "Empresa", render: (i) => companyName(i.company_id) }, { key: "parent_id", label: "Depende de", render: (i) => (i.parent_id ? deptName(i.parent_id) : "—") }, { key: "functional_area", label: "Área funcional" }],
      fields: [
        { name: "company_id", label: "Empresa", type: "select", required: true, onlyCreate: true, options: () => org.companies.map((c) => [c.id, c.name]) },
        { name: "name", label: "Nombre", required: true }, { name: "code", label: "Clave", required: true, hint: "Ej. OPS, VTA, PRC" },
        { name: "parent_id", label: "Depende de (sub-área)", type: "select", options: (cid) => org.departments.filter((d) => d.company_id === cid).map((d) => [d.id, d.name]) },
        { name: "functional_area", label: "Área funcional común", hint: "Permite comparar el mismo departamento entre empresas (ej. operaciones)." },
      ],
    },
    positions: {
      title: "puesto",
      cols: [{ key: "name", label: "Puesto" }, { key: "code", label: "Clave" }, { key: "company_id", label: "Empresa", render: (i) => companyName(i.company_id) }, { key: "department_id", label: "Departamento", render: (i) => (i.department_id ? deptName(i.department_id) : "—") }],
      fields: [
        { name: "company_id", label: "Empresa", type: "select", required: true, onlyCreate: true, options: () => org.companies.map((c) => [c.id, c.name]) },
        { name: "name", label: "Nombre", required: true }, { name: "code", label: "Clave", required: true, hint: "Ej. OPER, COORD, EJEC" },
        { name: "department_id", label: "Departamento", type: "select", options: (cid) => org.departments.filter((d) => d.company_id === cid).map((d) => [d.id, d.name]) },
      ],
    },
  };
  const c = cfg[table];
  const visible = filterCompany && table !== "companies" ? items.filter((i) => i.company_id === filterCompany) : items;

  return (
    <div className="space-y-3">
      {err && <Alert kind="error">{err}</Alert>}
      {canManage && (
        <div className="flex justify-end"><button className="btn-primary" onClick={() => setEditing("new")}><Plus className="size-4" /> Agregar {c.title}</button></div>
      )}
      {visible.length === 0 ? (
        <EmptyState title={`Sin registros`}>Agrega la primera {c.title}.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>{c.cols.map((col) => <th key={col.key} className="th">{col.label}</th>)}<th className="th">Estado</th>{canManage && <th className="th w-40" />}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((i) => (
                <tr key={i.id} className={i.is_active ? "" : "opacity-60"}>
                  {c.cols.map((col) => <td key={col.key} className="td">{col.render ? col.render(i) : String(i[col.key] ?? "—")}</td>)}
                  <td className="td"><Badge tone={i.is_active ? "green" : "slate"}>{i.is_active ? "Activo" : "Inactivo"}</Badge></td>
                  {canManage && (
                    <td className="td text-right">
                      <button className="btn-ghost px-2 py-1" onClick={() => setEditing(i)} aria-label={`Editar ${i.name}`}><Pencil className="size-4" /></button>
                      <button className="btn-ghost px-2 py-1 text-xs" disabled={pending}
                        onClick={() => start(async () => { const r = await setOrgItemActive(table, i.id, !i.is_active); setErr(r.ok ? null : r.error.message); })}>
                        {i.is_active ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ItemForm key={editing === "new" ? "new" : editing.id} table={table} item={editing === "new" ? null : editing} fields={c.fields}
          title={`${editing === "new" ? "Agregar" : "Editar"} ${c.title}`} defaultCompany={filterCompany ?? org.companies[0]?.id ?? ""} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ItemForm({ table, item, fields, title, defaultCompany, onClose }: {
  table: OrgTable; item: Item | null; fields: FieldDef[]; title: string; defaultCompany: string; onClose: () => void;
}) {
  const [state, action] = useActionState(async (prev: unknown, fd: FormData) => {
    const r = await saveOrgItem(table, item?.id ?? null, prev, fd);
    if (r.ok) onClose();
    return r;
  }, null);
  const [company, setCompany] = useState(String(item?.company_id ?? defaultCompany));
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={title}>
      <form action={action} className="space-y-3">
        {state && !state.ok && !state.error.fieldErrors && <Alert kind="error">{state.error.message}</Alert>}
        {fields.filter((f) => !(f.onlyCreate && item)).map((f) => (
          <Field key={f.name} label={f.label} htmlFor={f.name} error={fe[f.name]} hint={f.hint} required={f.required}>
            {f.type === "select" ? (
              <select id={f.name} name={f.name} className="input" defaultValue={f.name === "company_id" ? company : String(item?.[f.name] ?? (f.name === "timezone" ? "America/Mexico_City" : ""))}
                onChange={f.name === "company_id" ? (e) => setCompany(e.target.value) : undefined} required={f.required} aria-invalid={!!fe[f.name]}>
                {!f.required && <option value="">—</option>}
                {f.options!(company).filter(([v]) => v !== item?.id).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <input id={f.name} name={f.name} className="input" defaultValue={String(item?.[f.name] ?? "")} required={f.required} aria-invalid={!!fe[f.name]} />
            )}
          </Field>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

const TIMEZONES = ["America/Mexico_City", "America/Monterrey", "America/Merida", "America/Cancun", "America/Chihuahua", "America/Hermosillo", "America/Mazatlan", "America/Tijuana"];
