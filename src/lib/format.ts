import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";

export const DEFAULT_TZ = "America/Mexico_City";

/** Fecha en la zona horaria de la empresa (los timestamps se guardan en UTC). */
export function fmtDate(value: string | Date | null | undefined, tz = DEFAULT_TZ, pattern = "dd/MM/yyyy") {
  if (!value) return "—";
  return format(new TZDate(new Date(value), tz), pattern, { locale: es });
}
export const fmtDateTime = (v: string | Date | null | undefined, tz = DEFAULT_TZ) => fmtDate(v, tz, "dd/MM/yyyy HH:mm");
export const fmtRelative = (v: string | Date | null | undefined) =>
  v ? formatDistanceToNowStrict(new Date(v), { addSuffix: true, locale: es }) : "—";

/** Saludo según la hora local. */
export function greeting(tz = DEFAULT_TZ) {
  const h = new TZDate(new Date(), tz).getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

/** Normaliza texto para búsqueda (igual que app.norm en la base): minúsculas y sin acentos. */
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

export const STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  inactive: "Inactivo",
  suspended: "Suspendido",
  deleted: "Baja",
};

export const SCOPE_LABEL: Record<string, string> = {
  group: "Todo el grupo",
  company: "Empresa",
  branch: "Sucursal",
  department: "Departamento",
  team: "Su línea de reporte",
};

export function fmtBytes(n: number | null | undefined) {
  if (!n) return "0 MB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtDuration(seconds: number | null | undefined) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`;
}

/** Días que faltan para una fecha (negativo = vencido). */
export function daysLeft(due: string | null | undefined) {
  if (!due) return null;
  return Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
}

export const COURSE_STATUS: Record<string, [string, "slate" | "green" | "amber" | "red" | "blue"]> = {
  draft: ["Borrador", "slate"], review: ["En revisión", "blue"], published: ["Publicado", "green"],
  suspended: ["Suspendido", "amber"], archived: ["Archivado", "red"],
};
export const REQUIREMENT_LABEL: Record<string, string> = { mandatory: "Obligatorio", recommended: "Recomendado", optional: "Opcional" };
export const RULE_LABEL: Record<string, string> = {
  manual: "Botón «Marcar como completado»", on_view: "Al abrirla", min_time: "Tiempo mínimo",
  video_percent: "Ver el video", all_pages: "Ver todas las páginas",
};
