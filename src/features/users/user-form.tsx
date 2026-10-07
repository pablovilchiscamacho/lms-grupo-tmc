"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, Copy, KeyRound, Mail } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import type { OrgOptions } from "@/features/org/queries";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { searchPeople, type CreateUserResult } from "./actions";

export type UserFormValues = {
  first_name?: string; last_name_paternal?: string; last_name_maternal?: string | null; has_real_email?: boolean;
  email?: string | null; employee_number?: string | null; username?: string | null; phone?: string | null;
  company_id?: string; branch_id?: string | null; department_id?: string | null; position_id?: string | null;
  manager?: { id: string; full_name: string } | null; hire_date?: string | null;
};

type Action = (prev: unknown, fd: FormData) => Promise<ActionResult<CreateUserResult | undefined>>;

export function UserForm({ org, initial = {}, mode, action, canInvite = true, onReset }: {
  org: OrgOptions; initial?: UserFormValues; mode: "create" | "edit"; action: Action; canInvite?: boolean; onReset?: () => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const [company, setCompany] = useState(initial.company_id ?? (org.companies.length === 1 ? org.companies[0].id : ""));
  const [department, setDepartment] = useState(initial.department_id ?? "");
  const [hasEmail, setHasEmail] = useState(initial.has_real_email ?? true);
  const [access, setAccess] = useState<"invite" | "temp">("temp");
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};

  if (mode === "create" && state?.ok && state.data) return <Created result={state.data as CreateUserResult} onReset={onReset} />;

  const branches = org.branches.filter((b) => b.company_id === company);
  const departments = org.departments.filter((d) => d.company_id === company);
  const positions = org.positions.filter((p) => p.company_id === company && (!department || !p.department_id || p.department_id === department));
  const inp = (name: keyof typeof fe | string) => ({ id: name, name, "aria-invalid": !!fe[name], "aria-describedby": fe[name] ? `${name}-error` : undefined });

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state && !state.ok && <Alert kind="error">{state.error.message}</Alert>}
      {state?.ok && state.message && <Alert kind="success">{state.message}</Alert>}

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-3 text-sm font-semibold text-slate-800">Datos personales</legend>
        <Field label="Nombre(s)" htmlFor="first_name" error={fe.first_name} required>
          <input {...inp("first_name")} defaultValue={initial.first_name} className="input" autoComplete="off" required />
        </Field>
        <Field label="Apellido paterno" htmlFor="last_name_paternal" error={fe.last_name_paternal} required>
          <input {...inp("last_name_paternal")} defaultValue={initial.last_name_paternal} className="input" autoComplete="off" required />
        </Field>
        <Field label="Apellido materno" htmlFor="last_name_maternal" error={fe.last_name_maternal}>
          <input {...inp("last_name_maternal")} defaultValue={initial.last_name_maternal ?? ""} className="input" autoComplete="off" />
        </Field>
        <Field label="Número de empleado" htmlFor="employee_number" error={fe.employee_number}>
          <input {...inp("employee_number")} defaultValue={initial.employee_number ?? ""} className="input" autoComplete="off" />
        </Field>
        <Field label="Teléfono" htmlFor="phone" error={fe.phone}>
          <input {...inp("phone")} defaultValue={initial.phone ?? ""} className="input" inputMode="tel" autoComplete="off" />
        </Field>
        <Field label="Fecha de ingreso" htmlFor="hire_date" error={fe.hire_date}>
          <input {...inp("hire_date")} type="date" defaultValue={initial.hire_date ?? ""} className="input" />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-3 text-sm font-semibold text-slate-800">Acceso</legend>
        <div className="sm:col-span-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="has_real_email" checked={hasEmail} onChange={(e) => { setHasEmail(e.target.checked); if (!e.target.checked) setAccess("temp"); }} className="size-4 rounded border-slate-300" />
            Tiene correo corporativo
          </label>
        </div>
        {hasEmail && (
          <Field label="Correo corporativo" htmlFor="email" error={fe.email} required>
            <input {...inp("email")} type="email" defaultValue={initial.email ?? ""} className="input" autoComplete="off" />
          </Field>
        )}
        <Field label="Usuario (opcional)" htmlFor="username" error={fe.username} hint={hasEmail ? undefined : "Para entrar sin correo: usuario o número de empleado."}>
          <input {...inp("username")} defaultValue={initial.username ?? ""} className="input" autoComplete="off" placeholder="ej. juan.perez" />
        </Field>
        {mode === "create" && (
          <div className="sm:col-span-3">
            <p className="label">¿Cómo recibirá su acceso?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <AccessOption value="temp" current={access} onChange={setAccess} icon={<KeyRound className="size-4" />} title="Contraseña temporal"
                text="Se muestra una sola vez para entregarla en persona. La cambiará al entrar." />
              <AccessOption value="invite" current={access} onChange={setAccess} disabled={!hasEmail || !canInvite} icon={<Mail className="size-4" />} title="Invitación por correo"
                text={hasEmail ? "Recibe un enlace para definir su propia contraseña." : "Requiere correo corporativo."} />
            </div>
            <input type="hidden" name="access" value={access} />
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-3 text-sm font-semibold text-slate-800">Organización</legend>
        <Field label="Empresa" htmlFor="company_id" error={fe.company_id} required>
          <select {...inp("company_id")} value={company} onChange={(e) => { setCompany(e.target.value); setDepartment(""); }} className="input" required>
            <option value="">Elige…</option>
            {org.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Sucursal" htmlFor="branch_id" error={fe.branch_id}>
          <select key={`b-${company}`} {...inp("branch_id")} defaultValue={initial.company_id === company ? initial.branch_id ?? "" : ""} className="input" disabled={!company}>
            <option value="">Sin sucursal</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Departamento" htmlFor="department_id" error={fe.department_id}>
          <select {...inp("department_id")} value={department} onChange={(e) => setDepartment(e.target.value)} className="input" disabled={!company}>
            <option value="">Sin departamento</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Puesto" htmlFor="position_id" error={fe.position_id}>
          <select key={`p-${company}-${department}`} {...inp("position_id")} defaultValue={initial.company_id === company ? initial.position_id ?? "" : ""} className="input" disabled={!company}>
            <option value="">Sin puesto</option>
            {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <ManagerPicker initial={initial.manager ?? null} error={fe.manager_id} />
        </div>
      </fieldset>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Link href="/admin/usuarios" className="btn-ghost">Cancelar</Link>
        <SubmitButton pendingText="Guardando…">{mode === "create" ? "Crear usuario" : "Guardar cambios"}</SubmitButton>
      </div>
    </form>
  );
}

function AccessOption({ value, current, onChange, disabled, icon, title, text }: {
  value: "invite" | "temp"; current: string; onChange: (v: "invite" | "temp") => void; disabled?: boolean; icon: React.ReactNode; title: string; text: string;
}) {
  const active = current === value;
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(value)} aria-pressed={active}
      className={`rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20" : "border-slate-200 hover:border-slate-300"}`}>
      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">{icon} {title}</span>
      <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
    </button>
  );
}

/** Selector de jefe directo con búsqueda en el servidor (respeta el alcance del admin). */
function ManagerPicker({ initial, error }: { initial: { id: string; full_name: string } | null; error?: string }) {
  const [selected, setSelected] = useState(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; full_name: string; employee_number: string | null }[]>([]);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return;
    timer.current = setTimeout(() => start(async () => setResults(await searchPeople(q))), 250);
  }, [q]);

  return (
    <Field label="Jefe directo" htmlFor="manager_search" error={error}>
      <input type="hidden" name="manager_id" value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <span>{selected.full_name}</span>
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => { setSelected(null); setQ(""); setResults([]); }}>Cambiar</button>
        </div>
      ) : (
        <div className="relative">
          <input id="manager_search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe al menos 2 letras…" className="input" autoComplete="off"
            role="combobox" aria-expanded={results.length > 0} aria-controls="manager_results" />
          {q.trim().length >= 2 && (
            <ul id="manager_results" role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {pending && <li className="px-3 py-2 text-sm text-slate-500">Buscando…</li>}
              {!pending && results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Sin resultados</li>}
              {results.map((r) => (
                <li key={r.id} role="option" aria-selected={false}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setSelected(r); setResults([]); }}>
                    {r.full_name} {r.employee_number && <span className="text-slate-400">· {r.employee_number}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

function Created({ result, onReset }: { result: CreateUserResult; onReset?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <Alert kind="success" title="Usuario creado">
        {result.invited ? "Le enviamos un correo con un enlace para definir su contraseña." : "Entrega esta contraseña temporal en persona. Por seguridad no se volverá a mostrar."}
      </Alert>
      {result.tempPassword && (
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-lg tracking-wider">{result.tempPassword}</code>
          <button type="button" className="btn-secondary" onClick={async () => { await navigator.clipboard.writeText(result.tempPassword!); setCopied(true); }}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copiada" : "Copiar"}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={`/admin/usuarios/${result.id}`} className="btn-primary">Ver usuario y asignar roles</Link>
        {onReset && <button type="button" className="btn-secondary" onClick={onReset}>Crear otro</button>}
      </div>
    </div>
  );
}

/** Alta con opción "Crear otro" (re-monta el formulario para limpiar su estado). */
export function NewUserForm({ org, action }: { org: OrgOptions; action: Action }) {
  const [k, setK] = useState(0);
  return <UserForm key={k} org={org} mode="create" action={action} onReset={() => setK((n) => n + 1)} />;
}
