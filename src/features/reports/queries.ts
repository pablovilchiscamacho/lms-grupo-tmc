import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/features/dashboards/queries";

export type ReportFilters = Record<string, string | undefined>;
export type ReportPage = { total: number; rows: Record<string, unknown>[] };
export const EXPORT_MAX = 50_000;
const PAGE = 1000;

/** URL → filtros del reporte (los mismos nombres que los tableros, más `estado`). */
export function parseReportFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const f = parseFilters(sp);
  const status = typeof sp.estado === "string" && /^[a-z_]{2,20}$/.test(sp.estado) ? sp.estado : undefined;
  return {
    company_id: f.company_id, branch_id: f.branch_id, department_id: f.department_id, position_id: f.position_id,
    manager_id: f.manager_id, course_id: f.course_id, from: f.from, to: f.to, q: f.q, status,
  };
}

const clean = (f: ReportFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v));

export async function runReport(key: string, f: ReportFilters, limit = 100, offset = 0): Promise<ReportPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report", { p_key: key, f: clean(f), p_limit: limit, p_offset: offset });
  if (error) throw error;
  return data as ReportPage;
}

/** Todas las filas (por páginas de 1 000) hasta el máximo de exportación. */
export async function runReportAll(key: string, f: ReportFilters) {
  const first = await runReport(key, f, PAGE, 0);
  const rows = [...first.rows];
  const total = Math.min(first.total, EXPORT_MAX);
  while (rows.length < total) rows.push(...(await runReport(key, f, PAGE, rows.length)).rows);
  return { total: first.total, rows: rows.slice(0, EXPORT_MAX), truncated: first.total > EXPORT_MAX };
}

export async function logExport(key: string, format: string, f: ReportFilters, rows: number) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_report_export", { p_key: key, p_format: format, p_filters: clean(f), p_rows: rows });
  if (error) throw error;
}

/** Texto legible de los filtros aplicados (para el encabezado del PDF y la hoja de Excel). */
export async function describeFilters(f: ReportFilters) {
  const supabase = await createClient();
  const name = async (table: string, id?: string, col = "name") =>
    id ? ((await supabase.from(table).select(col).eq("id", id).maybeSingle()).data as Record<string, string> | null)?.[col] : undefined;
  const parts = [
    ["Empresa", await name("companies", f.company_id)], ["Sucursal", await name("branches", f.branch_id)],
    ["Departamento", await name("departments", f.department_id)], ["Puesto", await name("positions", f.position_id)],
    ["Jefe", await name("profiles", f.manager_id, "full_name")], ["Curso", await name("courses", f.course_id, "title")],
    ["Desde", f.from], ["Hasta", f.to], ["Búsqueda", f.q], ["Estado", f.status],
  ].filter(([, v]) => v) as [string, string][];
  return parts.length ? parts.map(([k, v]) => `${k}: ${v}`).join(" · ") : "Sin filtros (todo tu alcance)";
}
