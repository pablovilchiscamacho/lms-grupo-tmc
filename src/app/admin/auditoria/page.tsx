import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AuditList, type AuditEntry } from "@/components/audit-list";
import { ACTION_LABEL, ENTITY_LABEL } from "@/lib/audit-labels";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Auditoría" };
const LIMIT = 50;

export default async function AuditPage({ searchParams }: PageProps<"/admin/auditoria">) {
  const ctx = await requirePermission("audit.read", "/admin/auditoria");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : null);
  const before = Number(s("antes")) || null;
  const desde = s("desde"), hasta = s("hasta");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_audit", {
    p_entity_type: s("entidad"), p_action: s("accion"),
    p_from: desde ? new Date(`${desde}T00:00:00-06:00`).toISOString() : null,
    p_to: hasta ? new Date(`${hasta}T23:59:59.999-06:00`).toISOString() : null,
    p_before_id: before, p_limit: LIMIT,
  });
  if (error) throw error;
  const rows = (data ?? []) as AuditEntry[];
  type Chain = { ok: boolean; broken_at: number | null; sealed: number; pending: number; first_at: string | null; checked_at: string };
  const chain = sp.verificar ? ((await supabase.rpc("verify_audit_chain")).data as Chain | null) : null;
  const tz = ctx.profile.company.timezone;
  const nextHref = () => {
    const usp = new URLSearchParams();
    for (const k of ["entidad", "accion", "desde", "hasta"]) { const v = s(k); if (v) usp.set(k, v); }
    usp.set("antes", String(rows[rows.length - 1].id));
    return `?${usp}`;
  };

  return (
    <>
      <PageHeader title="Auditoría" description={<span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4 text-emerald-600" /> Bitácora de solo lectura. Ningún usuario, incluido el Super Admin, puede editarla o borrarla.</span>} />
      <section className="mb-4">
        {chain ? (
          chain.ok ? (
            <Alert kind="success" title="La bitácora está íntegra">
              Se verificaron {Number(chain.sealed).toLocaleString("es-MX")} registros desde el {fmtDateTime(chain.first_at, tz)}: ninguno fue alterado ni borrado
              (cada registro está encadenado al anterior con una huella digital). Verificado el {fmtDateTime(chain.checked_at, tz)}.
              {chain.pending > 0 && ` ${chain.pending} registro(s) recientes se sellan en el próximo minuto.`}
            </Alert>
          ) : (
            <Alert kind="error" title="Se detectó una alteración en la bitácora">
              <span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-4" /> El registro #{chain.broken_at} no coincide con su huella digital. Avisa de inmediato al responsable de sistemas.</span>
            </Alert>
          )
        ) : (
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-slate-600">Comprueba que nadie haya alterado o borrado registros de la bitácora (útil antes de una auditoría ISO).</p>
            <Link href="?verificar=1" className="btn-secondary"><ShieldCheck className="size-4" /> Verificar integridad</Link>
          </div>
        )}
      </section>
      <form className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <select name="entidad" defaultValue={s("entidad") ?? ""} className="input" aria-label="Entidad">
          <option value="">Todas las entidades</option>
          {Object.entries(ENTITY_LABEL).filter(([k]) => k !== "user_group_member").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="accion" defaultValue={s("accion") ?? ""} className="input" aria-label="Acción">
          <option value="">Todas las acciones</option>
          <option value="auth.">Accesos (login/logout)</option>
          {Object.entries(ACTION_LABEL).filter(([k]) => !k.startsWith("auth.")).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="date" name="desde" defaultValue={desde ?? ""} className="input" aria-label="Desde" />
        <input type="date" name="hasta" defaultValue={hasta ?? ""} className="input" aria-label="Hasta" />
        <div className="flex gap-2"><Link href="/admin/auditoria" className="btn-ghost">Limpiar</Link><button className="btn-secondary flex-1">Filtrar</button></div>
      </form>
      {rows.length === 0 ? <EmptyState title="Sin eventos con esos filtros" /> : <AuditList entries={rows} tz={tz} />}
      {rows.length === LIMIT && <div className="mt-4 flex justify-center"><Link href={nextHref()} className="btn-secondary">Ver anteriores</Link></div>}
    </>
  );
}
