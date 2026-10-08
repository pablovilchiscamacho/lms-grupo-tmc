import "server-only";
import { pdfSafe } from "@/lib/pdf-text";
import { LOGO_PNG_BASE64, LOGO_RATIO } from "@/lib/brand-logo";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { CERT_STATUS, REQUIREMENT, USER_STATUS } from "./catalog";

export type TrainingRecord = {
  person: { full_name: string; employee_number: string | null; company: string; branch: string | null; department: string | null;
    job_position: string | null; manager: string | null; hire_date: string | null; status: string };
  courses: { course: string; code: string; cycle: number; state: string; requirement: string; progress_status: string; result: string;
    progress_pct: number; final_score: number | null; assigned_at: string; due_at: string | null; passed_at: string | null; failed_at: string | null;
    content_completed_at: string | null; valid_until: string | null; hours: number; certificate: string | null; attempts: number }[];
  certificates: { number: string; course_title: string; issued_at: string; expires_at: string | null; score: number | null; status: string }[];
};

const NAVY = rgb(0x0f / 255, 0x2a / 255, 0x4a / 255);
const MUTED = rgb(0.39, 0.45, 0.53);
const INK = rgb(0.1, 0.12, 0.18);
const STRIPE = rgb(0.96, 0.97, 0.98);

const safe = pdfSafe;
const clip = (f: PDFFont, s: string, size: number, w: number) => {
  let t = safe(f, s);
  if (f.widthOfTextAtSize(t, size) <= w) return t;
  while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > w) t = t.slice(0, -1);
  return t + "…";
};

function status(c: TrainingRecord["courses"][number]) {
  if (c.state === "cancelled") return "Cancelado";
  if (c.state === "superseded") return "Ciclo anterior";
  if (c.result === "passed") return "Aprobado";
  if (c.result === "failed") return "Reprobado";
  if (c.result === "pending_review") return "En revisión";
  if (c.progress_status === "completed") return "Completado";
  if (c.due_at && new Date(c.due_at) < new Date()) return "Vencido";
  return c.progress_status === "in_progress" ? `En progreso (${Math.round(c.progress_pct)}%)` : "Pendiente";
}

/** Expediente de capacitación (carta vertical): datos de la persona, resumen, historial de cursos y constancias. */
export async function renderTrainingRecord(r: TrainingRecord, generatedBy: string, tz: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Expediente de capacitación · ${r.person.full_name}`);
  pdf.setCreator("LMS Grupo TMC");
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 36;
  const pages: PDFPage[] = [];
  let page!: PDFPage, y = 0;
  const newPage = () => { page = pdf.addPage([W, H]); pages.push(page); y = H - M; };
  const txt = (s: string, x: number, yy: number, size: number, font = reg, color = INK) => page.drawText(safe(font, s), { x, y: yy, size, font, color });

  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  newPage();
  page.drawImage(logo, { x: M, y: y - 32, width: 32 * LOGO_RATIO, height: 32 });
  const tx = M + 32 * LOGO_RATIO + 14;
  txt("Expediente de capacitación", tx, y - 14, 16, bold, NAVY);
  txt(`Generado por ${generatedBy} el ${fmtDateTime(new Date(), tz)}`, tx, y - 28, 8, reg, MUTED);
  y -= 56;

  const p = r.person;
  const facts: [string, string][] = [
    ["Nombre", p.full_name], ["Número de empleado", p.employee_number ?? "—"], ["Empresa", p.company], ["Sucursal", p.branch ?? "—"],
    ["Departamento", p.department ?? "—"], ["Puesto", p.job_position ?? "—"], ["Jefe directo", p.manager ?? "—"],
    ["Ingreso", p.hire_date ? fmtDate(p.hire_date, tz) : "—"], ["Estado", USER_STATUS[p.status as keyof typeof USER_STATUS] ?? p.status],
  ];
  facts.forEach(([k, v], i) => {
    const col = i % 3, row = Math.floor(i / 3), x = M + col * ((W - 2 * M) / 3), yy = y - row * 26;
    txt(k.toUpperCase(), x, yy, 6.5, bold, MUTED);
    page.drawText(clip(bold, v, 9.5, (W - 2 * M) / 3 - 8), { x, y: yy - 11, size: 9.5, font: bold, color: INK });
  });
  y -= Math.ceil(facts.length / 3) * 26 + 10;

  const active = r.courses.filter((c) => c.state !== "cancelled");
  const summary: [string, string][] = [
    ["Cursos asignados", String(active.filter((c) => c.state === "active").length)],
    ["Completados", String(active.filter((c) => c.progress_status === "completed").length)],
    ["Reprobados", String(active.filter((c) => c.state === "active" && c.result === "failed").length)],
    ["Horas", active.reduce((t, c) => t + Number(c.hours), 0).toLocaleString("es-MX", { maximumFractionDigits: 1 })],
    ["Constancias vigentes", String(r.certificates.filter((c) => c.status === "valid").length)],
  ];
  page.drawRectangle({ x: M, y: y - 38, width: W - 2 * M, height: 38, color: STRIPE });
  summary.forEach(([k, v], i) => {
    const x = M + 10 + i * ((W - 2 * M) / summary.length);
    txt(v, x, y - 18, 14, bold, NAVY);
    txt(k, x, y - 31, 7, reg, MUTED);
  });
  y -= 56;

  const table = (title: string, cols: { label: string; w: number; right?: boolean }[], rows: string[][], empty: string) => {
    if (y < M + 80) newPage();
    txt(title, M, y, 11, bold, NAVY); y -= 10;
    const total = cols.reduce((a, c) => a + c.w, 0), sc = (W - 2 * M) / total, ws = cols.map((c) => c.w * sc);
    const head = () => {
      page.drawRectangle({ x: M, y: y - 13, width: W - 2 * M, height: 14, color: NAVY });
      let x = M; cols.forEach((c, i) => { const t = clip(bold, c.label, 7, ws[i] - 4); page.drawText(t, { x: c.right ? x + ws[i] - 2 - bold.widthOfTextAtSize(t, 7) : x + 2, y: y - 9, size: 7, font: bold, color: rgb(1, 1, 1) }); x += ws[i]; });
      y -= 15;
    };
    head();
    if (rows.length === 0) { txt(empty, M + 2, y - 9, 8, reg, MUTED); y -= 16; }
    rows.forEach((row, n) => {
      if (y < M + 24) { newPage(); head(); }
      if (n % 2) page.drawRectangle({ x: M, y: y - 11, width: W - 2 * M, height: 13, color: STRIPE });
      let x = M; cols.forEach((c, i) => { const t = clip(reg, row[i] ?? "", 7.5, ws[i] - 4); page.drawText(t, { x: c.right ? x + ws[i] - 2 - reg.widthOfTextAtSize(t, 7.5) : x + 2, y: y - 8, size: 7.5, font: reg, color: INK }); x += ws[i]; });
      y -= 13;
    });
    y -= 16;
  };

  table("Historial de cursos",
    [{ label: "Curso", w: 30 }, { label: "Tipo", w: 11 }, { label: "Estado", w: 15 }, { label: "Calif.", w: 7, right: true }, { label: "Asignado", w: 10 },
     { label: "Terminó", w: 10 }, { label: "Vigencia", w: 10 }, { label: "Horas", w: 7, right: true }, { label: "Constancia", w: 15 }],
    r.courses.map((c) => [
      `${c.course}${c.cycle > 1 ? ` (ciclo ${c.cycle})` : ""}`, REQUIREMENT[c.requirement as keyof typeof REQUIREMENT] ?? c.requirement, status(c),
      c.final_score != null ? `${Number(c.final_score)}%` : "", fmtDate(c.assigned_at, tz),
      c.passed_at || c.content_completed_at ? fmtDate(c.passed_at ?? c.content_completed_at, tz) : c.failed_at ? `Reprobó ${fmtDate(c.failed_at, tz)}` : "",
      c.valid_until ? fmtDate(c.valid_until, tz) : "", Number(c.hours).toLocaleString("es-MX", { maximumFractionDigits: 1 }), c.certificate ?? "",
    ]), "Sin cursos asignados.");

  table("Constancias",
    [{ label: "Folio", w: 18 }, { label: "Curso", w: 40 }, { label: "Emisión", w: 12 }, { label: "Vigencia", w: 12 }, { label: "Calif.", w: 8, right: true }, { label: "Estado", w: 10 }],
    r.certificates.map((c) => [c.number, c.course_title, fmtDate(c.issued_at, tz), c.expires_at ? fmtDate(c.expires_at, tz) : "Sin vencimiento",
      c.score != null ? `${Number(c.score)}%` : "", CERT_STATUS[c.status as keyof typeof CERT_STATUS] ?? c.status]), "Sin constancias.");

  pages.forEach((pg, i) => {
    const t = `${r.person.full_name} · Página ${i + 1} de ${pages.length}`;
    pg.drawText(safe(reg, t), { x: W - M - reg.widthOfTextAtSize(safe(reg, t), 7), y: M - 18, size: 7, font: reg, color: MUTED });
  });
  return pdf.save();
}
