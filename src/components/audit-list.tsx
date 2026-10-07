import { actionLabel, FIELD_LABEL } from "@/lib/audit-labels";
import { fmtDateTime } from "@/lib/format";

export type AuditEntry = {
  id: number; occurred_at: string; actor_name: string | null; action: string; entity_type: string;
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; ip: string | null; sealed: boolean;
};

const HIDDEN = new Set(["id", "created_at", "created_by", "search", "full_name", "auth_email", "deleted_by"]);
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Sí" : "No") : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Lista de eventos con el detalle de qué cambió (valor anterior → nuevo). */
export function AuditList({ entries, tz }: { entries: AuditEntry[]; tz?: string }) {
  return (
    <ol className="space-y-3">
      {entries.map((e) => {
        const keys = Object.keys(e.new_data ?? e.old_data ?? {}).filter((k) => !HIDDEN.has(k));
        return (
          <li key={e.id} className="rounded-lg border border-slate-100 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-slate-800"><span className="font-medium">{e.actor_name ?? "Sistema"}</span> · {actionLabel(e.action)}</p>
              <p className="text-xs text-slate-400">{fmtDateTime(e.occurred_at, tz)}{e.ip ? ` · ${e.ip}` : ""}</p>
            </div>
            {e.action.endsWith(".updated") && keys.length > 0 && (
              <dl className="mt-2 grid gap-1 text-xs">
                {keys.slice(0, 12).map((k) => (
                  <div key={k} className="flex flex-wrap gap-1">
                    <dt className="font-medium text-slate-600">{FIELD_LABEL[k] ?? k}:</dt>
                    <dd className="text-slate-500"><span className="line-through">{show(e.old_data?.[k])}</span> → <span className="text-slate-800">{show(e.new_data?.[k])}</span></dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}
