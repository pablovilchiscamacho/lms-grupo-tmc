import "server-only";
import { pdfSafe } from "@/lib/pdf-text";
import { LOGO_PNG_BASE64, LOGO_RATIO } from "@/lib/brand-logo";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { fmtDate, fmtDateTime, fmtDuration } from "@/lib/format";
import { RESULT } from "@/features/reports/catalog";
import type { EnrollmentTrace } from "./queries";
import { ATTEMPT_STATUS, describeAnswer, EXCEPTION_LABEL, QTYPE } from "./format";

const NAVY = rgb(0x0f / 255, 0x2a / 255, 0x4a / 255);
const MUTED = rgb(0.39, 0.45, 0.53);
const INK = rgb(0.1, 0.12, 0.18);
const GREEN = rgb(0.02, 0.45, 0.3);
const RED = rgb(0.7, 0.1, 0.1);
const LINE = rgb(0.88, 0.9, 0.93);

const safe = pdfSafe;
function wrap(f: PDFFont, s: string, size: number, w: number) {
  const out: string[] = [];
  for (const para of safe(f, s).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > w && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Evidencia de trazabilidad (carta vertical): preguntas del auditor, lecciones, intentos con respuestas y constancia. */
export async function renderTracePdf(t: EnrollmentTrace, generatedBy: string, tz: string, chain: { ok: boolean; sealed: number } | null) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Trazabilidad · ${t.person.full_name} · ${t.course.code}`);
  pdf.setCreator("LMS Grupo TMC");
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 40, CW = W - 2 * M;
  const pages: PDFPage[] = [];
  let page!: PDFPage, y = 0;
  const newPage = () => { page = pdf.addPage([W, H]); pages.push(page); y = H - M; };
  const ensure = (h: number) => { if (y - h < M + 20) newPage(); };
  const para = (s: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; w?: number; gap?: number } = {}) => {
    const size = o.size ?? 9, font = o.font ?? reg, x = o.x ?? M, w = o.w ?? CW;
    for (const line of wrap(font, s, size, w)) { ensure(size + 3); page.drawText(line, { x, y: y - size, size, font, color: o.color ?? INK }); y -= size + 3; }
    y -= o.gap ?? 2;
  };
  const heading = (s: string) => { ensure(40); y -= 8; page.drawText(safe(bold, s), { x: M, y: y - 12, size: 12, font: bold, color: NAVY }); y -= 18; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE }); y -= 6; };
  const row = (k: string, v: string) => {
    const kl = wrap(bold, k, 8.5, 170), vl = wrap(reg, v, 8.5, CW - 180);
    const h = Math.max(kl.length, vl.length) * 11.5 + 4;
    ensure(h);
    kl.forEach((l, i) => page.drawText(l, { x: M, y: y - 9 - i * 11.5, size: 8.5, font: bold, color: MUTED }));
    vl.forEach((l, i) => page.drawText(l, { x: M + 180, y: y - 9 - i * 11.5, size: 8.5, font: reg, color: INK }));
    y -= h;
  };

  const e = t.enrollment;
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  newPage();
  page.drawImage(logo, { x: M, y: y - 32, width: 32 * LOGO_RATIO, height: 32 });
  const tx = M + 32 * LOGO_RATIO + 14;
  page.drawText(safe(bold, "Evidencia de trazabilidad de capacitación"), { x: tx, y: y - 14, size: 15, font: bold, color: NAVY });
  page.drawText(safe(reg, `Generado por ${generatedBy} el ${fmtDateTime(new Date(), tz)}`), { x: tx, y: y - 28, size: 8, font: reg, color: MUTED });
  y -= 50;
  para(`${t.person.full_name}${t.person.employee_number ? ` · núm. ${t.person.employee_number}` : ""} · ${[t.person.position, t.person.department, t.person.company].filter(Boolean).join(" · ")}`, { font: bold, size: 10 });
  para(`${t.course.title} (${t.course.code})${e.cycle > 1 ? ` · ciclo ${e.cycle}` : ""}`, { size: 10 });
  if (chain) para(chain.ok ? `Bitácora íntegra: se verificaron ${chain.sealed} registros encadenados sin alteraciones.` : "ATENCIÓN: la verificación de la bitácora detectó una alteración.", { size: 8, color: chain.ok ? GREEN : RED });

  const graders = [...new Set(t.attempts.flatMap((a) => a.questions.flatMap((q) => q.grades.map((g) => g.grader))))];
  const finished = t.attempts.filter((a) => a.status !== "in_progress");
  heading("Respuestas para el auditor (ISO §59)");
  row("¿Quién creó el curso?", `${t.course.created_by ?? "—"} · ${fmtDate(t.course.created_at, tz)}`);
  row("¿Quién lo modificó y cuándo?", `Último cambio registrado: ${t.course.last_change_at ? fmtDateTime(t.course.last_change_at, tz) : "—"} (detalle en la bitácora del curso)`);
  row("¿Qué versión tomó?", t.version ? `v${t.version.number}${t.version.published_at ? ` · publicada el ${fmtDate(t.version.published_at, tz)} por ${t.version.published_by ?? "—"}` : ""}${t.version.change_summary ? ` · «${t.version.change_summary}»` : ""}` : "Aún no la inicia");
  row("¿Quién se lo asignó?", `${e.assigned_by ?? "Regla automática"} · ${fmtDate(e.assigned_at, tz)}${e.due_at ? ` · fecha límite ${fmtDate(e.due_at, tz)}` : ""}`);
  row("¿Qué examen presentó?", finished.length ? finished.map((a) => `${a.exam} (intento ${a.number})`).join(", ") : "Ninguno");
  row("¿Qué respondió?", finished.length ? "Detalle por pregunta en la sección de intentos, tal como lo vio." : "—");
  row("¿Quién calificó?", finished.length ? (graders.length ? `Calificación automática y ${graders.join(", ")}` : "Calificación automática") : "—");
  row("¿Qué calificación recibió?", `${e.final_score != null ? `${Number(e.final_score)}% · ` : ""}${RESULT[e.result as keyof typeof RESULT] ?? e.result}`);
  row("¿Cuándo aprobó?", e.passed_at ? fmtDateTime(e.passed_at, tz) : e.content_completed_at && e.result === "none" ? `Terminó el ${fmtDateTime(e.content_completed_at, tz)}` : "No ha aprobado");
  row("¿Qué constancia obtuvo?", t.certificate ? `${t.certificate.number} · ${t.certificate.status === "revoked" ? `revocada: ${t.certificate.revoked_reason}` : "vigente"} · código ${t.certificate.verification_code}` : "Ninguna");

  heading("Lecciones");
  if (t.lessons.length === 0) para("Aún no inicia el curso.", { color: MUTED });
  for (const l of t.lessons) row(l.title + (l.required ? "" : " (opcional)"), `${l.status === "completed" ? `Completada ${l.completed_at ? fmtDateTime(l.completed_at, tz) : ""}` : l.status === "viewed" ? "Vista" : "Sin abrir"} · tiempo ${fmtDuration(l.seconds)}`);

  if (t.exceptions.length) {
    heading("Ajustes y excepciones");
    for (const x of t.exceptions) row(`${EXCEPTION_LABEL[x.type] ?? x.type} · ${fmtDateTime(x.created_at, tz)}`, `${x.granted_by ?? "—"} · motivo: ${x.reason}`);
  }

  for (const a of t.attempts) {
    heading(`${a.exam} · intento ${a.number} · ${a.status === "voided" ? "anulado" : a.passed ? "aprobado" : a.passed === false ? "reprobado" : ATTEMPT_STATUS[a.status] ?? a.status}`);
    row("Inicio / entrega", `${fmtDateTime(a.started_at, tz)} / ${a.submitted_at ? fmtDateTime(a.submitted_at, tz) : "—"} · duración ${fmtDuration(a.duration_seconds)}`);
    row("Calificación", `${a.score_pct != null ? `${Number(a.score_pct)}%` : "—"} (${Number(a.score_points)} de ${Number(a.max_points)} puntos)`);
    if (a.void_reason) row("Anulación", `${a.voided_by ?? "—"}: ${a.void_reason}`);
    y -= 4;
    for (const q of a.questions) {
      const d = describeAnswer(q);
      const pts = q.final_points ?? q.auto_points;
      ensure(40);
      para(`${q.position}. ${q.snapshot.prompt}`, { font: bold, size: 8.5, gap: 0 });
      para(`${QTYPE[q.snapshot.type] ?? q.snapshot.type} · ${pts != null ? `${Number(pts)} de ${Number(q.points)} pts` : "sin calificar"}${q.is_correct === true ? " · correcta" : q.is_correct === false ? (Number(pts ?? 0) > 0 ? " · parcialmente correcta" : " · incorrecta") : ""}`, { size: 7.5, color: MUTED, x: M + 10, w: CW - 10, gap: 0 });
      para(`Respondió: ${d.response}`, { size: 8.5, x: M + 10, w: CW - 10, gap: 0 });
      if (d.correct) para(`Correcta: ${d.correct}`, { size: 8.5, x: M + 10, w: CW - 10, color: GREEN, gap: 0 });
      for (const g of q.grades) para(`Calificó ${g.grader} · ${Number(g.score_pct)}% · ${fmtDateTime(g.created_at, tz)}${g.is_override ? " · recalificación" : ""}${g.feedback ? ` · «${g.feedback}»` : ""}`, { size: 7.5, x: M + 10, w: CW - 10, color: MUTED, gap: 0 });
      y -= 6;
    }
  }

  if (t.certificate) {
    heading("Constancia");
    row("Folio", t.certificate.number);
    row("Emitida / vigencia", `${fmtDateTime(t.certificate.issued_at, tz)} / ${t.certificate.expires_at ? fmtDate(t.certificate.expires_at, tz) : "sin vencimiento"}`);
    row("Código de verificación", t.certificate.verification_code);
    if (t.certificate.pdf_sha256) row("Huella del PDF (SHA-256)", t.certificate.pdf_sha256);
    if (t.certificate.revoked_at) row("Revocación", `${fmtDateTime(t.certificate.revoked_at, tz)} · ${t.certificate.revoked_by ?? "—"} · ${t.certificate.revoked_reason}`);
  }
  if (!t.includes_keys) { y -= 6; para("Las respuestas correctas solo se incluyen cuando lo genera quien califica o audita.", { size: 7.5, color: MUTED }); }

  pages.forEach((p, i) => {
    const s = safe(reg, `${t.person.full_name} · ${t.course.code} · Página ${i + 1} de ${pages.length}`);
    p.drawText(s, { x: W - M - reg.widthOfTextAtSize(s, 7), y: M - 18, size: 7, font: reg, color: MUTED });
  });
  return pdf.save();
}
