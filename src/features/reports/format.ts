import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Column } from "./catalog";

/** Texto de una celda (pantalla, CSV y PDF). Excel recibe valores tipados aparte. */
export function cellText(v: unknown, c: Column, tz?: string): string {
  if (v === null || v === undefined || v === "") return "";
  switch (c.type) {
    case "date": return fmtDate(String(v), tz);
    case "datetime": return fmtDateTime(String(v), tz);
    case "pct": return `${Number(v).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;
    case "hours": return Number(v).toLocaleString("es-MX", { maximumFractionDigits: 2 });
    case "num": return Number(v).toLocaleString("es-MX", { maximumFractionDigits: 1 });
    case "int": return String(v);
    case "bool": return v ? "Sí" : "No";
    case "enum": return c.enum?.[String(v)] ?? String(v);
    default: return String(v);
  }
}

/** Valor para Excel: números como números y fechas como fechas (para poder filtrar y sumar). */
export function cellValue(v: unknown, c: Column): string | number | Date | null {
  if (v === null || v === undefined || v === "") return null;
  switch (c.type) {
    case "date": case "datetime": return new Date(String(v));
    case "pct": return Number(v) / 100;
    case "int": case "num": case "hours": return Number(v);
    case "bool": return v ? "Sí" : "No";
    case "enum": return c.enum?.[String(v)] ?? String(v);
    default: return String(v);
  }
}
