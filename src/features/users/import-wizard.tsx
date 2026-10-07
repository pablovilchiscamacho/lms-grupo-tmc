"use client";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, RefreshCw, XCircle } from "lucide-react";
import clsx from "clsx";
import { Alert, Badge, Card } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { importBatch, linkImportedManagers, previewImport, revalidateImport } from "./import-actions";
import { FIELD_TITLES, IMPORT_FIELDS, type CheckedRow, type ImportOutcome, type RawRow } from "./import-shared";

const BATCH = 25;
type Filter = "all" | "valid" | "error" | "duplicate";

export function ImportWizard() {
  const [state, action] = useActionState(previewImport, null);
  const [rows, setRows] = useState<CheckedRow[] | null>(null);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) { setLastState(state); if (state?.ok && state.data) setRows(state.data); }

  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Record<number, RawRow>>({});
  const [revalidating, setRevalidating] = useState(false);
  const [mode, setMode] = useState<"invite_or_temp" | "temp">("temp");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ImportOutcome[] | null>(null);
  const [linkInfo, setLinkInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => ({
    valid: rows?.filter((r) => r.status === "valid").length ?? 0,
    error: rows?.filter((r) => r.status === "error").length ?? 0,
    duplicate: rows?.filter((r) => r.status === "duplicate").length ?? 0,
  }), [rows]);

  async function revalidate() {
    if (!rows) return;
    setRevalidating(true);
    const raw = rows.map((r) => editing[r.row] ?? r.raw);
    const res = await revalidateImport(raw);
    setRevalidating(false);
    if (!res.ok) return setError(res.error.message);
    setRows(res.data!); setEditing({}); setError(null);
  }

  async function runImport() {
    if (!rows) return;
    const valid = rows.filter((r) => r.status === "valid");
    if (!confirm(`¿Crear ${valid.length} usuario${valid.length === 1 ? "" : "s"}?`)) return;
    setError(null);
    const all: ImportOutcome[] = [];
    setProgress({ done: 0, total: valid.length });
    for (let i = 0; i < valid.length; i += BATCH) {
      const res = await importBatch(valid.slice(i, i + BATCH), mode);
      if (!res.ok) { setError(res.error.message); break; }
      all.push(...res.data!);
      setProgress({ done: Math.min(i + BATCH, valid.length), total: valid.length });
    }
    const links = all.filter((o) => o.ok && o.id && o.manager_ref).map((o) => ({ user_id: o.id!, manager_ref: o.manager_ref! }));
    if (links.length) {
      const l = await linkImportedManagers(links);
      setLinkInfo(l.ok ? `Jefes ligados: ${l.data!.linked} de ${links.length}.` + (l.data!.missing.length ? ` ${l.data!.missing.length} jefe(s) no se encontraron; asígnalos desde la ficha del usuario.` : "") : l.error.message);
    }
    setResults(all);
    setProgress(null);
  }

  function downloadAccess() {
    if (!results) return;
    const lines = [["Nombre", "Acceso", "Contraseña temporal"], ...results.filter((r) => r.ok && r.tempPassword).map((r) => [r.name, r.login ?? "", r.tempPassword!])];
    const csv = "﻿" + lines.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "accesos-temporales.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (results) {
    const ok = results.filter((r) => r.ok), bad = results.filter((r) => !r.ok);
    return (
      <div className="space-y-4">
        <Alert kind={bad.length ? "warning" : "success"} title="Importación terminada">
          {ok.length} usuario{ok.length === 1 ? "" : "s"} creado{ok.length === 1 ? "" : "s"}{bad.length ? `, ${bad.length} con error` : ""}.
          {linkInfo && <> {linkInfo}</>}
        </Alert>
        {ok.some((r) => r.tempPassword) && (
          <Card title="Contraseñas temporales">
            <p className="mb-3 text-sm text-slate-600">Descarga el archivo y entrégalo de forma segura; no se podrá volver a consultar. Cada persona deberá cambiar su contraseña al entrar.</p>
            <button className="btn-primary" onClick={downloadAccess}><Download className="size-4" /> Descargar accesos (CSV)</button>
          </Card>
        )}
        {bad.length > 0 && (
          <Card title="Filas que no se crearon">
            <ul className="space-y-1 text-sm">{bad.map((b) => <li key={b.row}>Fila {b.row} · {b.name}: <span className="text-red-600">{b.error}</span></li>)}</ul>
          </Card>
        )}
        <Link href="/admin/usuarios" className="btn-secondary">Ir a usuarios</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="file" className="label">Archivo Excel (.xlsx) o CSV</label>
            <input id="file" name="file" type="file" accept=".xlsx,.csv" required className="input file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-brand-800" />
          </div>
          <SubmitButton className="btn-primary" pendingText="Validando…"><FileSpreadsheet className="size-4" /> Validar archivo</SubmitButton>
          <a href="/plantillas/usuarios.csv" download className="btn-ghost"><Download className="size-4" /> Plantilla</a>
        </form>
        {state && !state.ok && <div className="mt-3"><Alert kind="error">{state.error.message}</Alert></div>}
      </Card>

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filtrar filas">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>Todas ({rows.length})</Chip>
            <Chip active={filter === "valid"} onClick={() => setFilter("valid")} icon={<CheckCircle2 className="size-4 text-emerald-600" />}>{counts.valid} válidos</Chip>
            <Chip active={filter === "error"} onClick={() => setFilter("error")} icon={<AlertTriangle className="size-4 text-amber-500" />}>{counts.error} con errores</Chip>
            <Chip active={filter === "duplicate"} onClick={() => setFilter("duplicate")} icon={<XCircle className="size-4 text-red-500" />}>{counts.duplicate} duplicados</Chip>
            {Object.keys(editing).length > 0 && (
              <button className="btn-secondary ml-auto" onClick={revalidate} disabled={revalidating}>
                {revalidating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Volver a validar
              </button>
            )}
          </div>
          {error && <Alert kind="error">{error}</Alert>}

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr><th className="th w-14">Fila</th><th className="th w-28">Estado</th><th className="th">Persona</th><th className="th">Empresa / área</th><th className="th">Observaciones</th><th className="th w-24" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.filter((r) => filter === "all" || r.status === filter).map((r) => {
                  const ed = editing[r.row];
                  return (
                    <tr key={r.row} className={clsx(r.status !== "valid" && "bg-amber-50/30")}>
                      <td className="td tabular-nums text-slate-400">{r.row}</td>
                      <td className="td">
                        <Badge tone={r.status === "valid" ? "green" : r.status === "error" ? "amber" : "red"}>
                          {r.status === "valid" ? "Válido" : r.status === "error" ? "Error" : "Duplicado"}
                        </Badge>
                      </td>
                      {ed ? (
                        <td className="td" colSpan={3}>
                          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                            {IMPORT_FIELDS.map((f) => (
                              <label key={f} className="text-xs text-slate-500">{FIELD_TITLES[f]}
                                <input className="input mt-0.5 py-1" value={ed[f] ?? ""} onChange={(e) => setEditing({ ...editing, [r.row]: { ...ed, [f]: e.target.value } })} />
                              </label>
                            ))}
                          </div>
                        </td>
                      ) : (
                        <>
                          <td className="td">
                            <div className="font-medium text-slate-800">{[r.raw.nombre, r.raw.apellido_paterno, r.raw.apellido_materno].filter(Boolean).join(" ") || "—"}</div>
                            <div className="text-xs text-slate-500">{r.raw.email || r.raw.usuario || (r.raw.numero_empleado ? `Núm. ${r.raw.numero_empleado}` : "Sin identificador")}</div>
                          </td>
                          <td className="td text-slate-600">{[r.raw.empresa, r.raw.sucursal, r.raw.departamento, r.raw.puesto].filter(Boolean).join(" · ")}</td>
                          <td className="td text-xs">
                            {r.status === "duplicate" && <p className="text-red-600">Ya existe (correo, número de empleado o usuario) o está repetido en el archivo.</p>}
                            {r.errors.map((e) => <p key={e} className="text-amber-700">{e}</p>)}
                            {r.status === "valid" && r.manager_ref && <p className="text-slate-500">Jefe {r.manager_ref}: se ligará al terminar.</p>}
                          </td>
                        </>
                      )}
                      <td className="td text-right">
                        {r.status !== "valid" && !ed && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setEditing({ ...editing, [r.row]: { ...r.raw } })}>Corregir</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Card>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <label htmlFor="mode" className="label">Acceso de los nuevos usuarios</label>
                <select id="mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  <option value="temp">Contraseña temporal para todos (descargas un archivo con los accesos)</option>
                  <option value="invite_or_temp">Invitación por correo a quien tenga correo; temporal a los demás</option>
                </select>
              </div>
              <button className="btn-primary" disabled={counts.valid === 0 || !!progress || Object.keys(editing).length > 0} onClick={runImport}>
                {progress ? <><Loader2 className="size-4 animate-spin" /> Creando {progress.done} de {progress.total}…</> : `Importar ${counts.valid} usuario${counts.valid === 1 ? "" : "s"} válidos`}
              </button>
            </div>
            {progress && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            )}
            {Object.keys(editing).length > 0 && <p className="mt-2 text-xs text-amber-700">Tienes correcciones sin validar: pulsa “Volver a validar”.</p>}
            <p className="mt-2 text-xs text-slate-500">Solo se crean las filas válidas. Las demás se ignoran hasta que las corrijas.</p>
          </Card>
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      className={clsx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", active ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
      {icon}{children}
    </button>
  );
}
