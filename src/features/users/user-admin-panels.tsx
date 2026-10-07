"use client";
import { useActionState, useState, useTransition } from "react";
import { Check, Copy, KeyRound, Mail, Trash2 } from "lucide-react";
import { Alert, Badge, Field } from "@/components/ui";
import { Modal, SubmitButton } from "@/components/ui/client";
import type { OrgOptions } from "@/features/org/queries";
import { grantRole, resetUserPassword, revokeRole, setUserStatus } from "./actions";
import type { UserRoleRow } from "./queries";

const STATUS_OPTIONS = [
  ["active", "Activo", "Puede entrar y tomar cursos."],
  ["inactive", "Inactivo", "No puede entrar. Se conserva todo su historial."],
  ["suspended", "Suspendido", "Bloqueo temporal (por ejemplo, investigación)."],
  ["deleted", "Baja", "Baja definitiva. El historial académico se conserva."],
] as const;

export function StatusPanel({ userId, status }: { userId: string; status: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: unknown, fd: FormData) => {
    const r = await setUserStatus(userId, prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, null);
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};
  if (status === "deleted") return <p className="text-sm text-slate-500">El usuario está dado de baja. Su historial se conserva para consulta.</p>;
  return (
    <>
      {state?.ok && <div className="mb-3"><Alert kind="success">{state.message}</Alert></div>}
      <button className="btn-secondary w-full" onClick={() => setOpen(true)}>Cambiar estado</button>
      <Modal open={open} onOpenChange={setOpen} title="Cambiar estado" description="El cambio queda registrado en la bitácora con el motivo.">
        <form action={action} className="space-y-4">
          {state && !state.ok && !state.error.fieldErrors && <Alert kind="error">{state.error.message}</Alert>}
          <fieldset className="space-y-2">
            <legend className="label">Nuevo estado</legend>
            {STATUS_OPTIONS.filter(([v]) => v !== status).map(([v, l, d], i) => (
              <label key={v} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-2.5 has-checked:border-brand-500 has-checked:bg-brand-50">
                <input type="radio" name="status" value={v} defaultChecked={i === 0} className="mt-0.5" />
                <span><span className="block text-sm font-medium text-slate-800">{l}</span><span className="block text-xs text-slate-500">{d}</span></span>
              </label>
            ))}
          </fieldset>
          <Field label="Motivo" htmlFor="reason" error={fe.reason} required>
            <textarea id="reason" name="reason" rows={2} className="input" required aria-invalid={!!fe.reason} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <SubmitButton pendingText="Guardando…">Confirmar cambio</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function AccessPanel({ userId, hasRealEmail, active }: { userId: string; hasRealEmail: boolean; active: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const run = (mode: "link" | "temp") =>
    start(async () => {
      setMsg(null); setTemp(null);
      const r = await resetUserPassword(userId, mode);
      if (!r.ok) return setMsg({ kind: "error", text: r.error.message });
      if (r.data?.tempPassword) setTemp(r.data.tempPassword);
      else setMsg({ kind: "success", text: r.message ?? "Listo." });
    });
  if (!active) return <p className="text-sm text-slate-500">Solo disponible para usuarios activos.</p>;
  return (
    <div className="space-y-3">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {temp && (
        <div className="space-y-2">
          <Alert kind="warning">Entrega esta contraseña en persona. No se volverá a mostrar y deberá cambiarla al entrar.</Alert>
          <div className="flex gap-2">
            <code className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono tracking-wider">{temp}</code>
            <button className="btn-secondary" onClick={async () => { await navigator.clipboard.writeText(temp); setCopied(true); }}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
        </div>
      )}
      {hasRealEmail && (
        <button className="btn-secondary w-full" disabled={pending} onClick={() => run("link")}><Mail className="size-4" /> Enviar enlace de restablecimiento</button>
      )}
      <button className="btn-secondary w-full" disabled={pending} onClick={() => { if (confirm("¿Asignar una contraseña temporal? La actual dejará de funcionar.")) run("temp"); }}>
        <KeyRound className="size-4" /> Asignar contraseña temporal
      </button>
    </div>
  );
}

const SCOPE_LABEL: Record<string, string> = { group: "Todo el grupo", company: "Empresa", branch: "Sucursal", department: "Departamento", team: "Su línea de reporte" };

export function RolesPanel({ userId, roles, allRoles, org, canAssign }: {
  userId: string; roles: UserRoleRow[]; allRoles: { key: string; name: string; description: string | null }[]; org: OrgOptions; canAssign: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: unknown, fd: FormData) => {
    const r = await grantRole(userId, prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, null);
  const [scope, setScope] = useState("group");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};

  const scopeName = (r: UserRoleRow) => {
    if (!r.scope_id) return SCOPE_LABEL[r.scope_type];
    const all = [...org.companies.map((c) => [c.id, c.name]), ...org.branches.map((b) => [b.id, b.name]), ...org.departments.map((d) => [d.id, d.name])];
    return `${SCOPE_LABEL[r.scope_type]}: ${all.find(([id]) => id === r.scope_id)?.[1] ?? "—"}`;
  };
  const scopeOptions: [string, string][] =
    scope === "company" ? org.companies.map((c) => [c.id, c.name])
    : scope === "branch" ? org.branches.map((b) => [b.id, `${org.companies.find((c) => c.id === b.company_id)?.short_name ?? ""} · ${b.name}`])
    : scope === "department" ? org.departments.map((d) => [d.id, `${org.companies.find((c) => c.id === d.company_id)?.short_name ?? ""} · ${d.name}`])
    : [];

  return (
    <div className="space-y-3">
      {err && <Alert kind="error">{err}</Alert>}
      {roles.length === 0 ? (
        <p className="text-sm text-slate-500">Empleado (sin roles administrativos).</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {roles.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="text-sm font-medium text-slate-800">{r.role?.name}</p>
                <p className="text-xs text-slate-500">{scopeName(r)}{r.expires_at ? ` · vence ${new Date(r.expires_at).toLocaleDateString("es-MX")}` : ""}</p>
              </div>
              {canAssign && (
                <button className="btn-ghost p-1.5 text-red-600" disabled={pending} aria-label={`Revocar ${r.role?.name}`}
                  onClick={() => { if (confirm(`¿Revocar el rol ${r.role?.name}?`)) start(async () => { const res = await revokeRole(userId, r.id); setErr(res.ok ? null : res.error.message); }); }}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAssign && <button className="btn-secondary w-full" onClick={() => setOpen(true)}>Asignar rol</button>}
      {state?.ok && <Badge tone="green">{state.message}</Badge>}
      <Modal open={open} onOpenChange={setOpen} title="Asignar rol" description="El alcance define sobre qué personas aplica el rol.">
        <form action={action} className="space-y-4">
          {state && !state.ok && !state.error.fieldErrors && <Alert kind="error">{state.error.message}</Alert>}
          <Field label="Rol" htmlFor="role" required>
            <select id="role" name="role" className="input" required>
              {allRoles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Alcance" htmlFor="scope_type" required>
            <select id="scope_type" name="scope_type" className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
              {Object.entries(SCOPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {scopeOptions.length > 0 && (
            <Field label="Ámbito" htmlFor="scope_id" error={fe.scope_id} required>
              <select id="scope_id" name="scope_id" className="input" required>
                <option value="">Elige…</option>
                {scopeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          )}
          <Field label="Vence (opcional)" htmlFor="expires_at" hint="Para roles temporales, por ejemplo una suplencia.">
            <input id="expires_at" name="expires_at" type="date" className="input" />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <SubmitButton pendingText="Asignando…">Asignar</SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
