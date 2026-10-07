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
