import "server-only";
import { pdfSafe } from "@/lib/pdf-text";
import ExcelJS from "exceljs";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { fmtDateTime } from "@/lib/format";
import type { Column, ReportDef } from "./catalog";
import { cellText, cellValue } from "./format";

export type ExportMeta = { def: ReportDef; filters: string; generatedBy: string; tz: string; total: number; truncated: boolean };
type Row = Record<string, unknown>;

// ---------------------------------------------------------------- CSV
/** CSV con BOM para que Excel abra bien los acentos. */
export function toCsv(rows: Row[], cols: Column[], tz: string) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  // Evita inyección de fórmulas al abrir el CSV en Excel.
  const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s);
  const lines = [cols.map((c) => esc(c.label)).join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(safe(cellText(r[c.key], c, tz)))).join(","));
  return new TextEncoder().encode("﻿" + lines.join("\r\n") + "\r\n");
}

// ---------------------------------------------------------------- Excel
/** Fecha con la hora local de la empresa (Excel no maneja zonas horarias). */
function wall(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

export async function toXlsx(rows: Row[], cols: Column[], m: ExportMeta) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LMS Grupo TMC";
  wb.created = new Date();
  const ws = wb.addWorksheet(m.def.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({
    header: c.label, key: c.key,
    width: c.width ?? (c.type === "datetime" ? 17 : c.type === "date" ? 12 : c.type === "text" || c.type === "enum" ? 16 : 12),
    style: { numFmt: c.type === "pct" ? "0.0%" : c.type === "date" ? "dd/mm/yyyy" : c.type === "datetime" ? "dd/mm/yyyy hh:mm" : c.type === "hours" ? "0.00" : c.type === "num" ? "0.0" : undefined },
  }));
  for (const r of rows) {
    ws.addRow(Object.fromEntries(cols.map((c) => {
      const v = cellValue(r[c.key], c);
      return [c.key, v instanceof Date ? wall(v, m.tz) : typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v];
    })));
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A4A" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const info = wb.addWorksheet("Información");
  info.columns = [{ width: 22 }, { width: 90 }];
  info.addRows([
    ["Reporte", m.def.title], ["Descripción", m.def.description], ["Filtros", m.filters],
    ["Generado por", m.generatedBy], ["Fecha", fmtDateTime(new Date(), m.tz)],
    ["Filas", m.truncated ? `${rows.length} de ${m.total} (máximo por exportación)` : String(rows.length)],
    ...(m.def.note ? [["Nota", m.def.note]] : []),
  ]);
  info.getColumn(1).font = { bold: true };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PDF
export const PDF_MAX_ROWS = 3000;
const NAVY = rgb(0x0f / 255, 0x2a / 255, 0x4a / 255);
const MUTED = rgb(0.39, 0.45, 0.53);
const INK = rgb(0.1, 0.12, 0.18);
const STRIPE = rgb(0.96, 0.97, 0.98);

const safeText = pdfSafe;
const clip = (f: PDFFont, s: string, size: number, w: number) => {
  let t = safeText(f, s);
  if (f.widthOfTextAtSize(t, size) <= w) return t;
  while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > w) t = t.slice(0, -1);
  return t + "…";
};

/** Tabla en PDF tamaño carta horizontal, con encabezado repetido y número de página. */
export async function toPdf(rows: Row[], cols: Column[], m: ExportMeta) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Reporte de ${m.def.title}`);
  pdf.setCreator("LMS Grupo TMC");
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 792, H = 612, M = 28, size = 7, rowH = 13;
  // Las columnas cortas (números, fechas) reciben el ancho exacto de su encabezado o contenido;
  // el resto del renglón se reparte entre las de texto en proporción a su peso.
  const avail = W - 2 * M;
  const headW = (c: Column) => bold.widthOfTextAtSize(safeText(bold, c.label), size) + 6;
  const fixedW = (c: Column) => Math.max(headW(c), c.type === "datetime" ? 62 : c.type === "date" ? 42 : 30);
  const isFlex = (c: Column) => c.type === "text" || c.type === "enum";
  const fixedTotal = cols.filter((c) => !isFlex(c)).reduce((t, c) => t + fixedW(c), 0);
  const flexUnits = cols.filter(isFlex).reduce((t, c) => t + (c.width ?? 14), 0) || 1;
  let widths = cols.map((c) => (isFlex(c) ? Math.max(headW(c), ((avail - fixedTotal) * (c.width ?? 14)) / flexUnits) : fixedW(c)));
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum > avail) widths = widths.map((w) => (w * avail) / sum);
  const right = (c: Column) => ["int", "num", "pct", "hours"].includes(c.type);
  const shown = rows.slice(0, PDF_MAX_ROWS);
  const pages: PDFPage[] = [];

  let page!: PDFPage, y = 0;
  const header = () => {
    page = pdf.addPage([W, H]); pages.push(page);
    y = H - M;
    if (pages.length === 1) {
      page.drawText(safeText(bold, `Reporte de ${m.def.title}`), { x: M, y: y - 14, size: 15, font: bold, color: NAVY });
      page.drawText(safeText(reg, "Grupo TMC · Capacitación"), { x: W - M - reg.widthOfTextAtSize("Grupo TMC · Capacitación", 9), y: y - 12, size: 9, font: reg, color: MUTED });
      y -= 30;
      for (const line of [m.filters, `Generado por ${m.generatedBy} el ${fmtDateTime(new Date(), m.tz)} · ${m.total} fila${m.total === 1 ? "" : "s"}${shown.length < m.total ? ` (se muestran ${shown.length}; descarga Excel para verlas todas)` : ""}`]) {
        page.drawText(clip(reg, line, 8, W - 2 * M), { x: M, y, size: 8, font: reg, color: MUTED }); y -= 11;
      }
      y -= 6;
    }
    page.drawRectangle({ x: M, y: y - rowH + 3, width: W - 2 * M, height: rowH + 2, color: NAVY });
    let x = M;
    cols.forEach((c, i) => {
      const t = clip(bold, c.label, size, widths[i] - 4);
      page.drawText(t, { x: right(c) ? x + widths[i] - 2 - bold.widthOfTextAtSize(t, size) : x + 2, y: y - 6, size, font: bold, color: rgb(1, 1, 1) });
      x += widths[i];
    });
    y -= rowH + 2;
  };
  header();
  shown.forEach((r, n) => {
    if (y < M + 18) header();
    if (n % 2 === 1) page.drawRectangle({ x: M, y: y - rowH + 4, width: W - 2 * M, height: rowH, color: STRIPE });
    let x = M;
    cols.forEach((c, i) => {
      const t = clip(reg, cellText(r[c.key], c, m.tz), size, widths[i] - 4);
      page.drawText(t, { x: right(c) ? x + widths[i] - 2 - reg.widthOfTextAtSize(t, size) : x + 2, y: y - 5, size, font: reg, color: INK });
      x += widths[i];
    });
    y -= rowH;
  });
  if (shown.length === 0) page.drawText("Sin filas con estos filtros.", { x: M, y: y - 10, size: 9, font: reg, color: MUTED });
  if (m.def.note) pages[pages.length - 1].drawText(safeText(reg, `Nota: ${m.def.note}`), { x: M, y: M - 4, size: 7, font: reg, color: MUTED });
  pages.forEach((p, i) => {
    const t = `Página ${i + 1} de ${pages.length}`;
    p.drawText(safeText(reg, t), { x: W - M - reg.widthOfTextAtSize(t, 7), y: M - 14, size: 7, font: reg, color: MUTED });
  });
  return pdf.save();
}
