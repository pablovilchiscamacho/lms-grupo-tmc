// Ejemplo completo para presentar el LMS: curso con presentación y examen → asignación → la persona estudia y presenta
// → un administrador califica la respuesta abierta → aprobación y constancia. Todo pasa por las mismas funciones
// que usa la plataforma (con la identidad de cada quien), así que la trazabilidad es real.
//   node scripts/demo-ejemplo.mjs
// Crea la cuenta de la persona de ejemplo y deja su acceso en el Escritorio (Demo-LMS-Mariana.txt).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { connect, loadEnv } from "./lib/db-env.mjs";

const env = loadEnv();
const { client, q } = await connect(env);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const log = (m) => console.log(`[${new Date().toLocaleTimeString("es-MX")}] ${m}`);

/** Ejecuta como un usuario de la plataforma (igual que PostgREST con su sesión). */
async function as(uid, aal, fn) {
  await q("begin");
  try {
    await q("set local role authenticated");
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated", aal })]);
    const r = await fn();
    await q("commit");
    return r;
  } catch (e) { await q("rollback"); throw e; }
}
const one = async (sql, p) => (await q(sql, p))[0];

// ---------------------------------------------------------------- datos base
const pablo = await one("select p.id, p.company_id from public.profiles p join public.user_roles ur on ur.user_id = p.id join public.roles r on r.id = ur.role_id where r.key = 'super_admin' and ur.revoked_at is null limit 1");
if (!pablo) throw new Error("No hay Super Admin");
if (await one("select 1 from public.courses where code = 'SEG-001'")) { console.error("✗ El curso SEG-001 ya existe: el ejemplo ya se creó."); process.exit(1); }
const org = await one(`select b.id branch, d.id dept, po.id pos from public.branches b, public.departments d, public.positions po
  where b.company_id = $1 and b.name = 'Manzanillo' and d.company_id = $1 and d.code = 'OPS' and po.company_id = $1 and po.code = 'OPER'`, [pablo.company_id]);
const ADM = (fn) => as(pablo.id, "aal2", fn);

// ---------------------------------------------------------------- 1. curso
log("Creando el curso…");
const course = await ADM(async () => (await one("select public.create_course($1) as id", [{
  code: "SEG-001", title: "Seguridad Operativa en Patio",
  description: "Reglas básicas de seguridad para maniobras de carga y descarga en patio: equipo de protección, revisión de sellos y qué hacer ante un accidente.",
  estimated_minutes: 30, validity_months: 12, issues_certificate: true,
}])).id);
const version = (await one("select id from public.course_versions where course_id = $1", [course])).id;
const moduleId = (await one("select id from public.course_modules where course_version_id = $1", [version])).id;

// Presentación en PDF (4 páginas, como una presentación exportada)
const slides = [
  ["Seguridad Operativa en Patio", "Grupo TMC · Capacitación", "Curso obligatorio para personal de operaciones"],
  ["1. Reglas generales", "• Velocidad máxima en patio: 10 km/h", "• Nunca cargar un contenedor sin revisar sus sellos", "• Respetar las zonas peatonales señalizadas"],
  ["2. Equipo de protección personal", "• Chaleco reflejante (obligatorio)", "• Casco y botas de seguridad", "• Guantes en maniobras de carga"],
  ["3. Ante un accidente", "1. Detener la maniobra", "2. Asegurar el área", "3. Avisar al jefe directo y a seguridad", "4. Registrar el incidente"],
];
const pdf = await PDFDocument.create();
const bold = await pdf.embedFont(StandardFonts.HelveticaBold), reg = await pdf.embedFont(StandardFonts.Helvetica);
for (const [title, ...lines] of slides) {
  const p = pdf.addPage([960, 540]);
  p.drawRectangle({ x: 0, y: 470, width: 960, height: 70, color: rgb(0.06, 0.16, 0.29) });
  p.drawText(title, { x: 50, y: 492, size: 30, font: bold, color: rgb(1, 1, 1) });
  lines.forEach((l, i) => p.drawText(l, { x: 70, y: 380 - i * 60, size: 26, font: reg, color: rgb(0.1, 0.12, 0.18) }));
}
const pdfBytes = Buffer.from(await pdf.save());
const sha = crypto.createHash("sha256").update(pdfBytes).digest("hex");
const prep = await ADM(async () => (await one("select public.file_prepare_upload($1) as r", [{
  course_id: course, name: "Reglamento de seguridad en patio.pdf", extension: "pdf", size_bytes: pdfBytes.length, sha256: sha, mime_type: "application/pdf",
}])).r);
const up = await admin.storage.from("course-content").upload(prep.path, pdfBytes, { contentType: "application/pdf" });
if (up.error) throw up.error;
await q("select public.file_finalize($1, $2)", [prep.file_id, { ok: true, mime_type: "application/pdf", page_count: 4, sha256: sha }]);

const [l1, l2] = await ADM(async () => {
  const a = (await one("insert into public.lessons (module_id, title, position, completion_rule) values ($1, 'Reglamento de seguridad en patio', 1, 'all_pages') returning id", [moduleId])).id;
  await q("insert into public.lesson_contents (lesson_id, type, file_id) values ($1, 'pdf', $2)", [a, prep.file_id]);
  const b = (await one("insert into public.lessons (module_id, title, position, completion_rule) values ($1, 'Equipo de protección personal', 2, 'manual') returning id", [moduleId])).id;
  await q("insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', $2)", [b,
    "<h2>Tu equipo de protección</h2><p>En el patio de maniobras el <strong>chaleco reflejante</strong> es obligatorio en todo momento. Además usa casco, botas de seguridad y guantes durante la carga y descarga.</p><p>Si tu equipo está dañado, repórtalo a tu jefe directo antes de iniciar el turno.</p>"]);
  return [a, b];
});

// ---------------------------------------------------------------- 2. examen
log("Armando el examen…");
const exam = await ADM(async () => {
  const ex = (await one("insert into public.exams (course_version_id, title, max_attempts, passing_score, shuffle_questions, shuffle_options) values ($1, 'Evaluación final', 2, 80, false, false) returning id", [version])).id;
  const questions = [
    { type: "true_false", prompt: "Se puede cargar un contenedor sin revisar los sellos.", tf_answer: false },
    { type: "single_choice", prompt: "¿Qué equipo de protección es obligatorio en el patio de maniobras?", options: [{ text: "Gorra" }, { text: "Chaleco reflejante", is_correct: true }, { text: "Lentes de sol" }] },
    { type: "multiple_choice", prompt: "¿Qué documentos acompañan un embarque de importación?", scoring: "partial",
      options: [{ text: "Factura comercial", is_correct: true }, { text: "Lista de empaque", is_correct: true }, { text: "Pedimento", is_correct: true }, { text: "Credencial de elector" }] },
    { type: "short_text", prompt: "¿Cuál es la velocidad máxima en el patio (en km/h)?", config: { accepted: ["10", "10 km/h", "10 kmh", "diez"] } },
    { type: "open_text", prompt: "Describe qué harías ante un accidente en el patio.", config: { rubric: "Detener la maniobra, asegurar el área, avisar al jefe y a seguridad, registrar el incidente." } },
  ];
  for (const qq of questions) {
    const qid = (await one("select public.save_question($1) as id", [qq])).id;
    await q("insert into public.exam_items (exam_id, question_id) values ($1, $2)", [ex, qid]);
  }
  return ex;
});
await ADM(() => q("select public.publish_course_version($1, 'Primera versión del curso')", [course]));
log("Curso publicado.");

// ---------------------------------------------------------------- 3. persona y asignación
log("Dando de alta a la persona de ejemplo…");
const A = "ABCDEFGHJKMNPQRSTUVWXYZ", all = A + "23456789abcdefghjkmnpqrstuvwxyz";
const pick = (s) => s[crypto.randomInt(s.length)];
const password = `${pick(A)}${Array.from({ length: 5 }, () => pick(all)).join("")}-${Array.from({ length: 5 }, () => pick(all)).join("")}`;
const authEmail = `demo-${crypto.randomBytes(5).toString("hex")}@users.lms.internal`;
const created = await admin.auth.admin.createUser({ email: authEmail, password, email_confirm: true });
if (created.error) throw created.error;
const mariana = created.data.user.id;
await ADM(() => q("select public.admin_create_user($1, $2)", [mariana, {
  first_name: "Mariana", last_name_paternal: "Torres", last_name_maternal: "Ruiz", has_real_email: false, email: null, auth_email: authEmail,
  username: "mariana.torres", employee_number: "DEMO-01", company_id: pablo.company_id, branch_id: org.branch, department_id: org.dept,
  position_id: org.pos, manager_id: pablo.id, hire_date: "2025-03-03", must_change_password: false,
}]));
await ADM(() => q("select public.create_assignment($1)", [{ course_id: course, mode: "direct", user_ids: [mariana], due_in_days: 15,
  notes: "Ejemplo para la presentación del LMS" }]));
log("Curso asignado a Mariana.");

// ---------------------------------------------------------------- 4. Mariana estudia (tiempos reales)
const EMP = (fn) => as(mariana, "aal1", fn);
log("Mariana abre la presentación…");
await EMP(() => q("select public.track_lesson($1, 'open')", [l1]));
await sleep(25); await EMP(() => q("select public.track_lesson($1, 'heartbeat', $2)", [l1, { pages: [1, 2] }]));
await sleep(25); await EMP(() => q("select public.track_lesson($1, 'heartbeat', $2)", [l1, { pages: [3] }]));
await sleep(25); const r1 = (await EMP(() => q("select public.track_lesson($1, 'heartbeat', $2) as r", [l1, { pages: [4] }])))[0].r;
log(`Presentación: ${r1.status}, ${r1.pages} páginas, ${r1.seconds} s`);
await EMP(() => q("select public.track_lesson($1, 'open')", [l2]));
await sleep(30); await EMP(() => q("select public.track_lesson($1, 'heartbeat')", [l2]));
await EMP(() => q("select public.complete_lesson($1)", [l2]));
log("Lecciones terminadas.");

// ---------------------------------------------------------------- 5. examen
const token = crypto.randomBytes(24).toString("hex");
const att = (await EMP(() => q("select public.start_attempt($1, $2) as r", [exam, token])))[0].r;
log("Mariana inicia el examen…");
const byType = (t) => att.questions.find((x) => x.snapshot.type === t);
const opt = (qq, text) => qq.snapshot.options.find((o) => o.text === text).id;
const answers = [
  [byType("true_false"), (qq) => ({ option_id: opt(qq, "Falso") })],
  [byType("single_choice"), (qq) => ({ option_id: opt(qq, "Chaleco reflejante") })],
  [byType("multiple_choice"), (qq) => ({ option_ids: [opt(qq, "Factura comercial"), opt(qq, "Lista de empaque")] })],   // le faltó el pedimento
  [byType("short_text"), () => ({ text: "10 km/h" })],
  [byType("open_text"), () => ({ text: "Detengo la maniobra, aseguro el área y aviso a mi jefe directo y al responsable de seguridad. Después registro el incidente." })],
];
for (const [qq, resp] of answers) {
  await sleep(12);
  await EMP(() => q("select public.save_answer($1, $2, $3, $4)", [att.attempt_id, qq.id, resp(qq), token]));
}
await sleep(8);
await EMP(() => q("select public.submit_attempt($1, $2)", [att.attempt_id, token]));
log("Examen entregado: la respuesta abierta queda en revisión.");

// ---------------------------------------------------------------- 6. calificación manual
await sleep(10);
const pending = (await ADM(() => q("select public.pending_reviews() as r")))[0].r;
const ans = pending.find((p) => p.attempt_id === att.attempt_id) ?? pending[0];
await ADM(() => q("select public.grade_answer($1, 90, $2)", [ans.answer_id,
  "Muy bien: detener, asegurar, avisar y registrar. Faltó mencionar los primeros auxilios mientras llega la ayuda."]));
log("Respuesta abierta calificada (90 %).");

// ---------------------------------------------------------------- resultado
const e = await one("select result, final_score, passed_at from public.enrollments where user_id = $1", [mariana]);
const cert = await one("select number, verification_code from public.certificates where user_id = $1", [mariana]);
await q("select app.compliance_snapshot_job()");
await client.end();
log(`Resultado: ${e.result}, calificación final ${e.final_score} %, constancia ${cert?.number ?? "—"}`);

const file = path.join(os.homedir(), "Desktop", "Demo-LMS-Mariana.txt");
fs.writeFileSync(file, [
  "EJEMPLO PARA LA PRESENTACIÓN · Plataforma de capacitación",
  "",
  "Vista del empleado (Mariana Torres Ruiz, operadora de Operaciones):",
  "  Dirección:  https://lms-grupo-tmc.vercel.app",
  "  Usuario:    mariana.torres",
  `  Contraseña: ${password}`,
  "  (Ábrela en una ventana privada para no cerrar tu sesión de administrador.)",
  "",
  `Constancia: ${cert?.number ?? "—"}`,
  `Verificación pública: https://lms-grupo-tmc.vercel.app/verify/certificate/${cert?.verification_code ?? ""}`,
  "",
  "Borra este archivo después de la presentación.",
].join("\n"), { mode: 0o600 });
log(`Accesos del ejemplo guardados en ${file}`);
