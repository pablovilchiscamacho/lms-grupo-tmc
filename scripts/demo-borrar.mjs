// Borra el ejemplo de la presentación (persona «mariana.torres» y curso SEG-001) con todo lo que generó.
// La bitácora NO se toca (es de solo-agregar): queda el historial y un evento «system.demo_removed».
//   node scripts/demo-borrar.mjs            → muestra qué borraría
//   node scripts/demo-borrar.mjs --ejecutar → lo borra (antes saca un respaldo cifrado)
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { connect, loadEnv } from "./lib/db-env.mjs";

const env = loadEnv();
const { client, q } = await connect(env);
const one = async (sql, p) => (await q(sql, p))[0];
const user = await one("select id, full_name from public.profiles where username = 'mariana.torres'");
const course = await one("select id, title from public.courses where code = 'SEG-001'");
if (!user && !course) { console.log("No hay ejemplo que borrar."); await client.end(); process.exit(0); }

const files = await q(`select f.id, f.bucket, f.storage_path from public.files f
  where f.course_id = $1 or f.id in (select pdf_file_id from public.certificates where user_id = $2 or course_id = $1)`, [course?.id ?? null, user?.id ?? null]);
console.log(`Persona: ${user?.full_name ?? "—"} · Curso: ${course?.title ?? "—"} · Archivos: ${files.length}`);
if (!process.argv.includes("--ejecutar")) { console.log("(Modo de prueba: no se borró nada. Agrega --ejecutar.)"); await client.end(); process.exit(0); }

const b = spawnSync("node", ["scripts/db-backup.mjs"], { encoding: "utf8" });
if (b.status !== 0) { console.error("✗ No se pudo sacar el respaldo previo; no se borra nada."); process.exit(1); }
console.log(b.stdout.trim().split("\n")[0]);

const T = ["notifications", "email_outbox", "certificates", "manual_grades", "attempt_answers", "attempt_events", "attempt_questions", "exam_attempts",
  "lesson_progress", "enrollment_exceptions", "enrollments", "assignments", "compliance_snapshots", "exam_items", "exam_pools", "exams",
  "question_options", "question_tags", "questions", "lesson_contents", "lessons", "course_modules", "course_versions", "course_instructors",
  "course_prerequisites", "courses", "files", "profile_hierarchy", "user_roles", "profiles"].map((t) => `public.${t}`);
await q("begin");
try {
  for (const t of [...T, "app.attempt_question_keys"]) await q(`alter table ${t} disable trigger user`);
  const C = course?.id ?? null, U = user?.id ?? null;
  const enr = (await q("select id from public.enrollments where course_id = $1 or user_id = $2", [C, U])).map((r) => r.id);
  const att = (await q("select id from public.exam_attempts where enrollment_id = any($1)", [enr])).map((r) => r.id);
  const qs = (await q(`select distinct ei.question_id id from public.exam_items ei join public.exams x on x.id = ei.exam_id
                       join public.course_versions v on v.id = x.course_version_id where v.course_id = $1`, [C])).map((r) => r.id);
  await q("delete from public.notifications where user_id = $1 or (entity_type = 'enrollment' and entity_id = any($2)) or (entity_type = 'exam_attempt' and entity_id = any($3))", [U, enr, att]);
  await q("delete from public.email_outbox where user_id = $1", [U]);
  await q("delete from public.certificates where enrollment_id = any($1)", [enr]);
  await q("delete from public.manual_grades where answer_id in (select id from public.attempt_answers where attempt_id = any($1))", [att]);
  await q("delete from public.attempt_answers where attempt_id = any($1)", [att]);
  await q("delete from public.attempt_events where attempt_id = any($1)", [att]);
  await q("delete from app.attempt_question_keys where attempt_question_id in (select id from public.attempt_questions where attempt_id = any($1))", [att]);
  await q("delete from public.attempt_questions where attempt_id = any($1)", [att]);
  await q("delete from public.exam_attempts where id = any($1)", [att]);
  await q("delete from public.lesson_progress where enrollment_id = any($1)", [enr]);
  await q("delete from public.enrollment_exceptions where enrollment_id = any($1)", [enr]);
  await q("delete from public.enrollments where id = any($1)", [enr]);
  await q("delete from public.assignments where course_id = $1", [C]);
  await q("delete from public.compliance_snapshots where course_id = $1", [C]);
  await q("update public.courses set current_version_id = null where id = $1", [C]);
  await q("delete from public.exam_items where exam_id in (select x.id from public.exams x join public.course_versions v on v.id = x.course_version_id where v.course_id = $1)", [C]);
  await q("delete from public.exam_pools where exam_id in (select x.id from public.exams x join public.course_versions v on v.id = x.course_version_id where v.course_id = $1)", [C]);
  await q("delete from public.exams where course_version_id in (select id from public.course_versions where course_id = $1)", [C]);
  await q("update public.questions set supersedes_id = null where supersedes_id = any($1)", [qs]);
  await q("delete from public.question_options where question_id = any($1)", [qs]);
  await q("delete from public.question_tags where question_id = any($1)", [qs]);
  await q("delete from public.questions where id = any($1)", [qs]);
  await q("delete from public.lesson_contents where lesson_id in (select l.id from public.lessons l join public.course_modules m on m.id = l.module_id join public.course_versions v on v.id = m.course_version_id where v.course_id = $1)", [C]);
  await q("delete from public.lessons where module_id in (select m.id from public.course_modules m join public.course_versions v on v.id = m.course_version_id where v.course_id = $1)", [C]);
  await q("delete from public.course_modules where course_version_id in (select id from public.course_versions where course_id = $1)", [C]);
  await q("delete from public.course_instructors where course_id = $1", [C]);
  await q("delete from public.course_prerequisites where course_id = $1 or required_course_id = $1", [C]);
  await q("delete from public.course_versions where course_id = $1", [C]);
  await q("delete from public.files where id = any($1)", [files.map((f) => f.id)]);
  await q("delete from public.courses where id = $1", [C]);
  await q("delete from public.profile_hierarchy where ancestor_id = $1 or descendant_id = $1", [U]);
  await q("delete from public.user_roles where user_id = $1", [U]);
  await q("delete from public.profiles where id = $1", [U]);
  for (const t of [...T, "app.attempt_question_keys"]) await q(`alter table ${t} enable trigger user`);
  await q("select app.log('system.demo_removed', 'system', null, null, null, $1::jsonb)",
    [JSON.stringify({ note: "Se borró el ejemplo de la presentación", person: user?.full_name, course: course?.title, files: files.length })]);
  await q("commit");
} catch (e) { await q("rollback"); console.error("✗ No se borró nada:", e.message); process.exit(1); }
await client.end();

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
if (user) { const r = await admin.auth.admin.deleteUser(user.id); if (r.error) console.error("  ! cuenta de acceso:", r.error.message); }
for (const [bucket, list] of Object.entries(Object.groupBy(files, (f) => f.bucket))) {
  const r = await admin.storage.from(bucket).remove(list.map((f) => f.storage_path));
  if (r.error) console.error(`  ! ${bucket}: ${r.error.message}`);
}
console.log("✓ Ejemplo borrado (persona, curso, examen, constancia, archivos y cuenta de acceso).");
