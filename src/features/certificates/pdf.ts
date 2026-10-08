import "server-only";
import { pdfSafe } from "@/lib/pdf-text";
import { LOGO_PNG_BASE64, LOGO_RATIO } from "@/lib/brand-logo";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { fmtDate } from "@/lib/format";
import { prettyCode } from "./format";

export type CertificateData = {
  number: string; verification_code: string; holder_name: string; course_title: string; course_code: string;
  company_name: string; instructor_name: string | null; score: number | null; duration_minutes: number | null;
  issued_at: string; expires_at: string | null; signer_name: string | null; signer_title: string | null;
};

const NAVY = rgb(0x0f / 255, 0x2a / 255, 0x4a / 255);
const BRAND = rgb(0x24 / 255, 0x50 / 255, 0x8d / 255);
const MUTED = rgb(0.39, 0.45, 0.53);
const INK = rgb(0.06, 0.09, 0.16);
const LINE = rgb(0.85, 0.88, 0.92);


/** Constancia en PDF tamaño carta horizontal, con QR de verificación. Sin dependencias de navegador. */
export async function renderCertificate(c: CertificateData, verifyUrl: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Constancia ${c.number}`);
  pdf.setAuthor("Grupo TMC · Capacitación");
  pdf.setSubject(`${c.course_title} · ${c.holder_name}`);
  pdf.setCreator("LMS Grupo TMC");
  pdf.setCreationDate(new Date(c.issued_at));
  pdf.setModificationDate(new Date(c.issued_at));   // mismo contenido → mismos bytes → mismo sha256

  const page = pdf.addPage([792, 612]);
  const { width: W, height: H } = page.getSize();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // Marco
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: NAVY, borderWidth: 2.5 });
  page.drawRectangle({ x: 26, y: 26, width: W - 52, height: H - 52, borderColor: LINE, borderWidth: 0.8 });
  page.drawRectangle({ x: 26, y: H - 34, width: W - 52, height: 8, color: NAVY });

  // Marca
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  page.drawImage(logo, { x: 56, y: H - 104, width: 46 * LOGO_RATIO, height: 46 });
  text(page, "Capacitación corporativa", regular, 9.5, 56, H - 118, { color: MUTED });
  text(page, `Folio ${c.number}`, bold, 9.5, W - 56, H - 76, { align: "right", color: NAVY });
  text(page, c.company_name, regular, 9.5, W - 56, H - 91, { align: "right", color: MUTED });

  // Cuerpo
  const cx = W / 2;
  text(page, "CONSTANCIA DE CAPACITACIÓN", bold, 13, cx, H - 160, { align: "center", color: BRAND, spacing: 2.5 });
  text(page, "Se otorga a", italic, 12, cx, H - 196, { align: "center", color: MUTED });
  const nameSize = fit(c.holder_name, bold, 32, W - 160);
  text(page, c.holder_name, bold, nameSize, cx, H - 236, { align: "center", color: INK });
  page.drawLine({ start: { x: cx - 210, y: H - 250 }, end: { x: cx + 210, y: H - 250 }, color: LINE, thickness: 1 });
  text(page, "por haber acreditado satisfactoriamente el curso", regular, 12, cx, H - 276, { align: "center", color: MUTED });
  let ts = 20, lines = wrap(c.course_title, bold, ts, W - 200);
  if (lines.length > 2) { ts = 15; lines = wrap(c.course_title, bold, ts, W - 200).slice(0, 3); }
  const lh = ts + 5;
  lines.forEach((l, i) => text(page, l, bold, ts, cx, H - 306 - i * lh, { align: "center", color: NAVY }));
  text(page, `Clave ${c.course_code}`, regular, 9.5, cx, H - 324 - (lines.length - 1) * lh, { align: "center", color: MUTED });

  // Datos
  const facts: [string, string][] = [
    ["Fecha de aprobación", fmtDate(c.issued_at, undefined, "dd/MM/yyyy")],
    ["Calificación", c.score != null ? `${Number(c.score).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%` : "Acreditado"],
    ["Vigencia", c.expires_at ? `Hasta ${fmtDate(c.expires_at, undefined, "dd/MM/yyyy")}` : "Sin vencimiento"],
  ];
  if (c.duration_minutes) facts.push(["Duración", c.duration_minutes >= 60 ? `${+(c.duration_minutes / 60).toFixed(1)} h` : `${c.duration_minutes} min`]);
  const colW = 130, startX = cx - (facts.length * colW) / 2, fy = H - 392;
  facts.forEach(([k, v], i) => {
    const x = startX + i * colW + colW / 2;
    text(page, k.toUpperCase(), bold, 7.5, x, fy, { align: "center", color: MUTED, spacing: 0.8 });
    text(page, v, bold, 12, x, fy - 17, { align: "center", color: INK });
  });

  // Firmas
  const sy = 112;
  const signer = c.signer_name || "Coordinación de Capacitación";
  page.drawLine({ start: { x: 70, y: sy }, end: { x: 290, y: sy }, color: INK, thickness: 0.8 });
  text(page, signer, bold, 10.5, 180, sy - 15, { align: "center", color: INK });
  text(page, c.signer_title || "Grupo TMC", regular, 9, 180, sy - 28, { align: "center", color: MUTED });
  if (c.instructor_name) {
    page.drawLine({ start: { x: 320, y: sy }, end: { x: 520, y: sy }, color: INK, thickness: 0.8 });
    text(page, c.instructor_name, bold, 10.5, 420, sy - 15, { align: "center", color: INK });
    text(page, "Instructor", regular, 9, 420, sy - 28, { align: "center", color: MUTED });
  }

  // QR de verificación
  const qrSize = 92, qx = W - 56 - qrSize, qy = 84;
  drawQr(page, verifyUrl, qx, qy, qrSize);
  text(page, "Verifica su autenticidad", bold, 8, qx + qrSize / 2, qy - 11, { align: "center", color: INK });
  text(page, prettyCode(c.verification_code), regular, 7.5, qx + qrSize / 2, qy - 22, { align: "center", color: MUTED });
  text(page, verifyUrl.replace(/^https?:\/\//, "").replace(/\/[^/]+$/, "/…"), regular, 6.5, qx + qrSize / 2, qy - 32, { align: "center", color: MUTED });

  return pdf.save();
}

function drawQr(page: PDFPage, value: string, x: number, y: number, size: number) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / n;
  page.drawRectangle({ x: x - 4, y: y - 4, width: size + 8, height: size + 8, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.get(r, col)) page.drawRectangle({ x: x + col * cell, y: y + size - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: INK });
    }
  }
}

const safe = pdfSafe;

function text(page: PDFPage, s: string, font: PDFFont, size: number, x: number, y: number,
  o: { align?: "left" | "center" | "right"; color?: ReturnType<typeof rgb>; spacing?: number } = {}) {
  const t = safe(font, s);
  const w = font.widthOfTextAtSize(t, size) + (o.spacing ?? 0) * Math.max(0, t.length - 1);
  const x0 = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
  if (o.spacing) {
    let cx = x0;
    for (const ch of t) { page.drawText(ch, { x: cx, y, size, font, color: o.color ?? INK }); cx += font.widthOfTextAtSize(ch, size) + o.spacing; }
  } else page.drawText(t, { x: x0, y, size, font, color: o.color ?? INK });
}

function fit(s: string, font: PDFFont, max: number, width: number) {
  let size = max;
  while (size > 16 && font.widthOfTextAtSize(safe(font, s), size) > width) size -= 1;
  return size;
}

function wrap(s: string, font: PDFFont, size: number, width: number) {
  const words = safe(font, s).split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  return out;
}
