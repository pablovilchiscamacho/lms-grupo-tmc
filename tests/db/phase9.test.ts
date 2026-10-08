import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
type Who = { uid: string; aal: "aal1" | "aal2" };
const T: Who = { uid: ID.trainer, aal: "aal2" };
const SUPER: Who = { uid: ID.super, aal: "aal2" };
const HR: Who = { uid: ID.hrEa, aal: "aal2" };
const MGR: Who = { uid: ID.mgrOps, aal: "aal1" };
const JUAN: Who = { uid: ID.empOps1, aal: "aal1" };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
const TOKEN = "token-del-dispositivo-0123456789";

type Trace = {
  course: { created_by: string }; version: { number: number; published_by: string };
  enrollment: { assigned_by: string; result: string; final_score: number };
  attempts: { number: number; questions: { snapshot: { prompt: string }; response: unknown; key: unknown; grades: { grader: string; feedback: string }[] }[] }[];
  certificate: { number: string } | null; includes_keys: boolean;
};
let course: string, enrollment: string;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  course = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code: "ISO-1", title: "ISO 9001 Introducción" }]))).id;
  const v = (await one(q<{ id: string }>(db, T, "select id from public.course_versions where course_id = $1", [course]))).id;
  const m = await one(q<{ id: string }>(db, T, "select id from public.course_modules where course_version_id = $1", [v]));
  const l = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position) values ($1, 'Política de calidad', 1) returning id", [m.id]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
  const ex = (await one(q<{ id: string }>(db, T, "insert into public.exams (course_version_id, max_attempts, passing_score, shuffle_questions, shuffle_options) values ($1, 2, 70, false, false) returning id", [v]))).id;
  for (const qq of [{ type: "true_false", prompt: "La política se comunica a todos", tf_answer: true }, { type: "open_text", prompt: "¿Qué es la mejora continua?", config: { rubric: "PDCA" } }]) {
    const qid = (await one(q<{ id: string }>(db, T, "select public.save_question($1) as id", [qq]))).id;
    await q(db, T, "insert into public.exam_items (exam_id, question_id) values ($1, $2)", [ex, qid]);
  }
  await q(db, T, "select public.publish_course_version($1, 'Primera versión')", [course]);
  await q(db, T, "select public.create_assignment($1)", [{ course_id: course, mode: "direct", user_ids: [ID.empOps1], due_in_days: 10 }]);
  enrollment = (await one(db.query<{ id: string }>("select id from public.enrollments where user_id = $1", [ID.empOps1]).then((r) => r.rows))).id;

  // Juan estudia, presenta, y Capacitación califica la abierta.
  await q(db, JUAN, "select public.track_lesson($1, 'open')", [l]);
  await q(db, JUAN, "select public.complete_lesson($1)", [l]);
  const p = (await one(q<{ r: { attempt_id: string; questions: { id: string; snapshot: { type: string; options?: { id: string; text: string }[] } }[] } }>(db, JUAN, "select public.start_attempt($1, $2) as r", [ex, TOKEN]))).r;
  const tf = p.questions.find((x) => x.snapshot.type === "true_false")!;
  const open = p.questions.find((x) => x.snapshot.type === "open_text")!;
  await q(db, JUAN, "select public.save_answer($1, $2, $3, $4)", [p.attempt_id, tf.id, { option_id: tf.snapshot.options!.find((o) => o.text === "Verdadero")!.id }, TOKEN]);
  await q(db, JUAN, "select public.save_answer($1, $2, $3, $4)", [p.attempt_id, open.id, { text: "Planear, hacer, verificar y actuar" }, TOKEN]);
  await q(db, JUAN, "select public.submit_attempt($1, $2)", [p.attempt_id, TOKEN]);
  const list = (await one(q<{ r: { answer_id: string }[] }>(db, T, "select public.pending_reviews() as r"))).r;
  await q(db, T, "select public.grade_answer($1, 90, 'Menciona el ciclo PDCA')", [list[0].answer_id]);
});

describe("Las 10 preguntas del auditor (§59)", () => {
  it("una sola consulta responde quién creó, qué versión, qué respondió, quién calificó, cuánto sacó, cuándo aprobó y qué constancia", async () => {
    const t = (await one(q<{ r: Trace }>(db, SUPER, "select public.enrollment_trace($1) as r", [enrollment]))).r;
    expect(t.course.created_by).toBe("Tomás Capacita");
    expect(t.version).toMatchObject({ number: 1, published_by: "Tomás Capacita" });
    expect(t.enrollment).toMatchObject({ assigned_by: "Tomás Capacita", result: "passed" });
    expect(Number(t.enrollment.final_score)).toBe(95);
    const qs = t.attempts[0].questions;
    expect(qs.map((x) => x.snapshot.prompt)).toEqual(["La política se comunica a todos", "¿Qué es la mejora continua?"]);
    expect(qs[1].response).toEqual({ text: "Planear, hacer, verificar y actuar" });
    expect(qs[1].grades[0]).toMatchObject({ grader: "Tomás Capacita", feedback: "Menciona el ciclo PDCA" });
    expect(qs[0].key).not.toBeNull();
    expect(t.certificate?.number).toMatch(/^TMC-\d{4}-\d{6}$/);
  });

  it("el jefe ve la trazabilidad de su equipo pero sin las respuestas correctas; RH de otra empresa no la ve", async () => {
    const t = (await one(q<{ r: Trace }>(db, MGR, "select public.enrollment_trace($1) as r", [enrollment]))).r;
    expect(t.includes_keys).toBe(false);
    expect(t.attempts[0].questions.every((x) => x.key === null)).toBe(true);
    expect(await errorOf(q(db, JUAN, "select public.enrollment_trace($1)", [enrollment]))).toBe("FORBIDDEN");
    await db.query("update public.user_roles set scope_id = $1 where user_id = $2", [ID.tmc, ID.hrEa]);
    expect(await errorOf(q(db, HR, "select public.enrollment_trace($1)", [enrollment]))).toBe("FORBIDDEN");
    await db.query("update public.user_roles set scope_id = $1 where user_id = $2", [ID.ea, ID.hrEa]);
  });

  it("el historial del curso trae versiones (quién publicó, qué cambió, cuántos la tomaron) y todos sus cambios", async () => {
    const v = (await one(q<{ r: { course: { created_by: string }; versions: { number: number; change_summary: string; took: number; passed: number }[] } }>(db, T, "select public.course_versions_trace($1) as r", [course]))).r;
    expect(v.versions[0]).toMatchObject({ number: 1, change_summary: "Primera versión", took: 1, passed: 1 });
    const h = await q<{ action: string }>(db, SUPER, "select action from public.course_history($1)", [course]);
    const actions = new Set(h.map((x) => x.action));
    for (const a of ["course.created", "course_version.created", "lesson.created", "exam.created", "exam_item.created", "assignment.created"]) expect(actions.has(a), a).toBe(true);
    expect(await errorOf(q(db, JUAN, "select * from public.course_history($1)", [course]))).toBe("FORBIDDEN");
  });

  it("al publicar v2, el historial de Juan sigue diciendo v1 — Aprobado", async () => {
    await q(db, T, "select public.create_draft_version($1)", [course]);
    await q(db, T, "select public.publish_course_version($1, 'Se actualizó la política 2026')", [course]);
    const h = (await one(q<{ r: { version: number; result: string }[] }>(db, JUAN, "select public.my_history() as r"))).r;
    expect(h[0]).toMatchObject({ version: 1, result: "passed" });
    const v = (await one(q<{ r: { versions: { number: number }[] } }>(db, T, "select public.course_versions_trace($1) as r", [course]))).r;
    expect(v.versions.map((x) => x.number)).toEqual([2, 1]);
  });
});

describe("Integridad", () => {
  it("la cadena de la bitácora se verifica y detecta una alteración", async () => {
    await db.query("select audit.seal()");
    const ok = (await one(q<{ r: { ok: boolean; sealed: number } }>(db, SUPER, "select public.verify_audit_chain() as r"))).r;
    expect(ok.ok).toBe(true);
    expect(Number(ok.sealed)).toBeGreaterThan(10);
    // Alguien con acceso directo a la base cambia un registro viejo: la verificación lo detecta.
    await db.query("alter table audit.audit_logs disable trigger user");
    const [{ id }] = (await db.query<{ id: number }>("update audit.audit_logs set action = 'course.deleted' where id = (select min(id) + 5 from audit.audit_logs) returning id")).rows;
    await db.query("alter table audit.audit_logs enable trigger user");
    const bad = (await one(q<{ r: { ok: boolean; broken_at: number } }>(db, SUPER, "select public.verify_audit_chain() as r"))).r;
    expect(bad).toMatchObject({ ok: false, broken_at: id });
    expect(await errorOf(q(db, JUAN, "select public.verify_audit_chain()"))).toBe("FORBIDDEN");
  });
});
