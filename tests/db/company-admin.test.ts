import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

/**
 * Administradora de UNA empresa (como Iliana en el piloto de ATPVA): roles de Capacitación y de RH con alcance
 * de empresa. Debe poder operar todo en su empresa y nada fuera de ella.
 */
let db: PGlite;
const ILIANA = "00000000-0000-4000-9000-0000000000a1";
const NUEVO = "00000000-0000-4000-9000-0000000000a2";
const IL = { uid: ILIANA, aal: "aal2" as const };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
const TOKEN = "token-del-dispositivo-0123456789";
let course: string, exam: string, lesson: string;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  await db.query("insert into auth.users (id, email) values ($1, 'iliana@tmc.test')", [ILIANA]);
  await db.query(`insert into public.profiles (id, first_name, last_name_paternal, email, auth_email, company_id)
                  values ($1, 'Iliana', 'Capital Humano', 'iliana@tmc.test', 'iliana@tmc.test', $2)`, [ILIANA, ID.tmc]);
  for (const role of ["training_admin", "hr_admin"]) {
    await db.query(`insert into public.user_roles (user_id, role_id, scope_type, scope_id) select $1, id, 'company', $2 from public.roles where key = $3`, [ILIANA, ID.tmc, role]);
  }
});

describe("Administradora de una sola empresa", () => {
  it("da de alta personas en su empresa, pero no en otra", async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'nuevo@tmc.test')", [NUEVO]);
    await q(db, IL, "select public.admin_create_user($1, $2)", [NUEVO, { first_name: "Nuevo", last_name_paternal: "Operador", email: "nuevo@tmc.test",
      auth_email: "nuevo@tmc.test", has_real_email: true, company_id: ID.tmc, branch_id: ID.tmcQro, department_id: ID.tmcOps, employee_number: "501" }]);
    expect(await errorOf(q(db, IL, "select public.admin_create_user(gen_random_uuid(), $1)", [{ first_name: "X", last_name_paternal: "Y",
      email: "x@ea.test", auth_email: "x@ea.test", has_real_email: true, company_id: ID.ea }]))).toBe("FORBIDDEN");
  });

  it("crea cursos de su empresa (no de «todo el grupo») con preguntas propias y los publica", async () => {
    expect(await errorOf(q(db, IL, "select public.create_course($1)", [{ code: "GRP-1", title: "De todo el grupo" }]))).toBe("FORBIDDEN");
    course = (await one(q<{ id: string }>(db, IL, "select public.create_course($1) as id", [{ code: "ATP-1", title: "Inducción ATPVA", owner_company_id: ID.tmc }]))).id;
    const v = (await one(q<{ id: string }>(db, IL, "select id from public.course_versions where course_id = $1", [course]))).id;
    const m = await one(q<{ id: string }>(db, IL, "select id from public.course_modules where course_version_id = $1", [v]));
    lesson = (await one(q<{ id: string }>(db, IL, "insert into public.lessons (module_id, title, position) values ($1, 'L1', 1) returning id", [m.id]))).id;
    await q(db, IL, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [lesson]);
    exam = (await one(q<{ id: string }>(db, IL, "insert into public.exams (course_version_id, max_attempts, passing_score, shuffle_questions, shuffle_options) values ($1, 2, 70, false, false) returning id", [v]))).id;
    for (const qq of [{ type: "true_false", prompt: "¿Usar chaleco?", tf_answer: true, owner_company_id: ID.tmc },
                      { type: "open_text", prompt: "Explica el procedimiento", owner_company_id: ID.tmc }]) {
      const qid = (await one(q<{ id: string }>(db, IL, "select public.save_question($1) as id", [qq]))).id;
      await q(db, IL, "insert into public.exam_items (exam_id, question_id) values ($1, $2)", [exam, qid]);
    }
    await q(db, IL, "select public.publish_course_version($1)", [course]);
    // Sus preguntas no las ve RH de otra empresa.
    expect(await q(db, { uid: ID.hrEa, aal: "aal2" }, "select id from public.questions where owner_company_id = $1", [ID.tmc])).toHaveLength(0);
  });

  it("asigna por área en su empresa, pero no en otra", async () => {
    const r = await one(q<{ r: { created: number } }>(db, IL, "select public.create_assignment($1) as r",
      [{ course_id: course, mode: "rule", company_id: ID.tmc, department_id: ID.tmcOps, include_future_users: true, due_in_days: 15 }]));
    expect(r.r.created).toBe(2);   // Pedro y el nuevo operador
    expect(await errorOf(q(db, IL, "select public.create_assignment($1)", [{ course_id: course, mode: "rule", company_id: ID.ea }]))).toBe("FORBIDDEN");
  });

  it("califica las respuestas abiertas de su gente", async () => {
    const emp = { uid: ID.empTmc, aal: "aal1" as const };
    await q(db, emp, "select public.track_lesson($1, 'open')", [lesson]);
    await q(db, emp, "select public.complete_lesson($1)", [lesson]);
    const p = (await one(q<{ r: { attempt_id: string; questions: { id: string; snapshot: { type: string; options?: { id: string; text: string }[] } }[] } }>(db, emp, "select public.start_attempt($1, $2) as r", [exam, TOKEN]))).r;
    const tf = p.questions.find((x) => x.snapshot.type === "true_false")!, op = p.questions.find((x) => x.snapshot.type === "open_text")!;
    await q(db, emp, "select public.save_answer($1, $2, $3, $4)", [p.attempt_id, tf.id, { option_id: tf.snapshot.options!.find((o) => o.text === "Verdadero")!.id }, TOKEN]);
    await q(db, emp, "select public.save_answer($1, $2, $3, $4)", [p.attempt_id, op.id, { text: "Detener y avisar" }, TOKEN]);
    await q(db, emp, "select public.submit_attempt($1, $2)", [p.attempt_id, TOKEN]);
    const pending = (await one(q<{ r: { answer_id: string }[] }>(db, IL, "select public.pending_reviews() as r"))).r;
    expect(pending).toHaveLength(1);
    await q(db, IL, "select public.grade_answer($1, 100, 'Correcto')", [pending[0].answer_id]);
    expect((await one(db.query<{ result: string }>("select result from public.enrollments where user_id = $1", [ID.empTmc]).then((x) => x.rows))).result).toBe("passed");
  });

  it("ve tableros, reportes, constancias y trazabilidad solo de su empresa", async () => {
    const s = (await one(q<{ r: { enrollments: { assigned: number; completed: number } } }>(db, IL, "select public.dashboard_summary('{}') as r"))).r;
    expect(s.enrollments).toMatchObject({ assigned: 2, completed: 1 });
    const users = (await one(q<{ r: { rows: { empresa: string }[] } }>(db, IL, "select public.report('users', '{}', 100, 0) as r"))).r.rows;
    expect(new Set(users.map((u) => u.empresa))).toEqual(new Set(["TMC"]));
    expect(await q(db, IL, "select * from public.certificates")).toHaveLength(1);
    const e = await one(db.query<{ id: string }>("select id from public.enrollments where user_id = $1", [ID.empTmc]).then((x) => x.rows));
    expect((await one(q<{ r: { includes_keys: boolean } }>(db, IL, "select public.enrollment_trace($1) as r", [e.id]))).r.includes_keys).toBe(true);
  });

  it("no cambia la configuración global ni revoca constancias", async () => {
    expect(await errorOf(q(db, IL, "select public.save_notification_settings('{\"enabled\":true}', null)"))).toBe("FORBIDDEN");
    const k = await one(db.query<{ id: string }>("select id from public.certificates limit 1").then((x) => x.rows));
    expect(await errorOf(q(db, IL, "select public.revoke_certificate($1, 'prueba de permiso')", [k.id]))).toBe("FORBIDDEN");
  });
});
