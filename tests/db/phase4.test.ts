import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
const T = { uid: ID.trainer, aal: "aal2" as const };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
const rows = async <R,>(sql: string, params: unknown[] = []) => (await db.query<R>(sql, params)).rows;

let course: string, lesson: string, exam: string, ruleAssignment: string;
const NEW_USER = "00000000-0000-4000-9000-0000000000f1";

async function makeCourse(code: string, opts: { exam?: boolean; validity?: number } = {}) {
  const id = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code, title: `Curso ${code}`, validity_months: opts.validity ?? null }]))).id;
  const v = (await one(q<{ id: string }>(db, T, "select id from public.course_versions where course_id = $1", [id]))).id;
  const m = await one(q<{ id: string }>(db, T, "select id from public.course_modules where course_version_id = $1", [v]));
  const l = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position) values ($1, 'L1', 1) returning id", [m.id]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
  let ex: string | undefined;
  if (opts.exam) {
    ex = (await one(q<{ id: string }>(db, T, "insert into public.exams (course_version_id, max_attempts, passing_score, shuffle_questions, shuffle_options) values ($1, 1, 80, false, false) returning id", [v]))).id;
    const qid = (await one(q<{ id: string }>(db, T, "select public.save_question($1) as id", [{ type: "true_false", prompt: "¿Es seguro?", tf_answer: true }]))).id;
    await q(db, T, "insert into public.exam_items (exam_id, question_id) values ($1, $2)", [ex, qid]);
  }
  await q(db, T, "select public.publish_course_version($1)", [id]);
  return { id, lesson: l, exam: ex };
}

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  const c = await makeCourse("ASG-1", { exam: true, validity: 12 });
  course = c.id; lesson = c.lesson; exam = c.exam!;
});

describe("Asignación por regla", () => {
  it("la vista previa cuenta a las personas activas que cumplen el filtro", async () => {
    const r = await one(q<{ r: { matching: number } }>(db, T, "select public.preview_assignment($1) as r", [{ course_id: course, company_id: ID.ea, department_id: ID.eaOps }]));
    expect(r.r.matching).toBe(3); // Mario, Juan, Ana
  });

  it("asigna a Operaciones de EA con fecha relativa y para usuarios futuros", async () => {
    const r = await one(q<{ r: { assignment_id: string; created: number } }>(db, T, "select public.create_assignment($1) as r",
      [{ course_id: course, mode: "rule", company_id: ID.ea, department_id: ID.eaOps, include_future_users: true, due_in_days: 10 }]));
    ruleAssignment = r.r.assignment_id;
    expect(r.r.created).toBe(3);
    const due = await one(q<{ ok: boolean }>(db, T, "select (due_at = app.end_of_day(app.local_today('America/Mexico_City') + 10, 'America/Mexico_City')) as ok from public.enrollments where user_id = $1", [ID.empOps1]));
    expect(due.ok).toBe(true);
    const n = await rows<{ type: string }>("select type from public.notifications where user_id = $1", [ID.empOps1]);
    expect(n.map((x) => x.type)).toContain("course_assigned");
  });

  it("RH sin permiso de asignar no puede crear asignaciones", async () => {
    expect(await errorOf(q(db, { uid: ID.hrEa, aal: "aal2" }, "select public.create_assignment($1)", [{ course_id: course, mode: "rule", company_id: ID.ea }])))
      .toBe("FORBIDDEN");
  });

  it("quien entra después a Operaciones recibe el curso solo", async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'nuevo.operador@ea.test')", [NEW_USER]);
    await db.query(`insert into public.profiles (id, first_name, last_name_paternal, email, auth_email, company_id, department_id)
                    values ($1, 'Nuevo', 'Operador', 'nuevo.operador@ea.test', 'nuevo.operador@ea.test', $2, $3)`, [NEW_USER, ID.ea, ID.eaOps]);
    const e = await rows<{ assignment_id: string; state: string }>("select assignment_id, state from public.enrollments where user_id = $1", [NEW_USER]);
    expect(e).toEqual([{ assignment_id: ruleAssignment, state: "active" }]);
  });

  it("si cambia de área, se cancela lo no iniciado; lo iniciado se conserva", async () => {
    await q(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'open')", [lesson]); // Juan ya empezó
    await db.query("update public.profiles set department_id = $1 where id in ($2, $3)", [ID.eaVta, ID.empOps1, NEW_USER]);
    const r = await rows<{ user_id: string; state: string; cancel_reason: string | null }>(
      "select user_id, state, cancel_reason from public.enrollments where user_id in ($1, $2) order by user_id", [ID.empOps1, NEW_USER]);
    expect(r).toEqual([
      { user_id: ID.empOps1, state: "active", cancel_reason: null },
      { user_id: NEW_USER, state: "cancelled", cancel_reason: "Cambio de puesto o área" },
    ]);
    await db.query("update public.profiles set department_id = $1 where id = $2", [ID.eaOps, ID.empOps1]);
  });

  it("al dar de baja se cancelan los cursos no iniciados", async () => {
    await db.query("update public.profiles set status = 'inactive' where id = $1", [ID.mgrOps]);
    const r = await one(db.query<{ state: string }>("select state from public.enrollments where user_id = $1", [ID.mgrOps]).then((x) => x.rows));
    expect(r.state).toBe("cancelled");
    await db.query("update public.profiles set status = 'active' where id = $1", [ID.mgrOps]);
  });

  it("una asignación desactivada deja de inscribir a quienes llegan", async () => {
    await q(db, T, "select public.set_assignment_active($1, false)", [ruleAssignment]);
    await db.query("update public.profiles set department_id = $1 where id = $2", [ID.eaOps, NEW_USER]);
    const e = await rows("select 1 from public.enrollments where user_id = $1 and state = 'active'", [NEW_USER]);
    expect(e).toEqual([]);
  });
});

describe("Excepciones", () => {
  let enrAna: string;
  it("prórroga: cambia la fecha límite y avisa", async () => {
    enrAna = (await one(db.query<{ id: string }>("select id from public.enrollments where user_id = $1 and course_id = $2 and state = 'active'", [ID.empOps2, course]).then((r) => r.rows))).id;
    expect(await errorOf(q(db, { uid: ID.hrEa, aal: "aal2" }, "select public.grant_exception($1, 'due_extension', $2, 'Vacaciones')", [enrAna, { date: "2030-01-31" }])))
      .toBe("FORBIDDEN");
    await q(db, T, "select public.grant_exception($1, 'due_extension', $2, 'Vacaciones')", [enrAna, { date: "2030-01-31" }]);
    const r = await one(db.query<{ d: string }>("select to_char(due_at at time zone 'America/Mexico_City', 'YYYY-MM-DD HH24:MI') d from public.enrollments where id = $1", [enrAna]).then((x) => x.rows));
    expect(r.d).toBe("2030-01-31 23:59");
    expect((await rows<{ type: string }>("select type from public.notifications where user_id = $1 and type = 'extension'", [ID.empOps2])).length).toBe(1);
  });

  it("intento extra: quien reprobó con su único intento puede volver a presentar", async () => {
    const token = "token-del-dispositivo-0123456789";
    await q(db, { uid: ID.empOps2 }, "select public.track_lesson($1, 'open')", [lesson]);
    await q(db, { uid: ID.empOps2 }, "select public.complete_lesson($1)", [lesson]);
    const p = (await one(q<{ r: { attempt_id: string; questions: { id: string; snapshot: { options: { id: string; text: string }[] } }[] } }>(
      db, { uid: ID.empOps2 }, "select public.start_attempt($1, $2) as r", [exam, token]))).r;
    const falso = p.questions[0].snapshot.options.find((o) => o.text === "Falso")!.id;
    await q(db, { uid: ID.empOps2 }, "select public.save_answer($1, $2, $3, $4)", [p.attempt_id, p.questions[0].id, { option_id: falso }, token]);
    await q(db, { uid: ID.empOps2 }, "select public.submit_attempt($1, $2)", [p.attempt_id, token]);
    expect((await one(db.query<{ result: string }>("select result from public.enrollments where id = $1", [enrAna]).then((x) => x.rows))).result).toBe("failed");
    await q(db, T, "select public.grant_exception($1, 'extra_attempts', $2, 'Segunda oportunidad autorizada')", [enrAna, { exam_id: exam, attempts: 1 }]);
    expect((await one(db.query<{ result: string }>("select result from public.enrollments where id = $1", [enrAna]).then((x) => x.rows))).result).toBe("none");
    const again = (await one(q<{ r: { attempt_id: string; questions: { id: string; snapshot: { options: { id: string; text: string }[] } }[] } }>(
      db, { uid: ID.empOps2 }, "select public.start_attempt($1, $2) as r", [exam, token]))).r;
    const verdadero = again.questions[0].snapshot.options.find((o) => o.text === "Verdadero")!.id;
    await q(db, { uid: ID.empOps2 }, "select public.save_answer($1, $2, $3, $4)", [again.attempt_id, again.questions[0].id, { option_id: verdadero }, token]);
    await q(db, { uid: ID.empOps2 }, "select public.submit_attempt($1, $2)", [again.attempt_id, token]);
    const e = await one(db.query<{ result: string; valid_until: string | null }>("select result, valid_until from public.enrollments where id = $1", [enrAna]).then((x) => x.rows));
    expect(e.result).toBe("passed");
    expect(e.valid_until).not.toBeNull(); // vigencia de 12 meses
  });

  it("reasignar crea un ciclo nuevo y conserva el anterior en el historial", async () => {
    const enrJuan = (await one(db.query<{ id: string }>("select id from public.enrollments where user_id = $1 and course_id = $2 and state = 'active'", [ID.empOps1, course]).then((r) => r.rows))).id;
    const newId = (await one(q<{ id: string }>(db, T, "select public.grant_exception($1, 'reassign', $2, 'Empezar de nuevo') as id", [enrJuan, { date: "2030-02-28" }]))).id;
    const r = await rows<{ id: string; cycle: number; state: string }>("select id, cycle, state from public.enrollments where user_id = $1 and course_id = $2 order by cycle", [ID.empOps1, course]);
    expect(r).toEqual([{ id: enrJuan, cycle: 1, state: "superseded" }, { id: newId, cycle: 2, state: "active" }]);
  });
});

describe("Recapacitación, vigencia y recordatorios", () => {
  it("publicar con «requiere recapacitación» abre un ciclo nuevo para quien ya aprobó", async () => {
    await q(db, T, "select public.create_draft_version($1)", [course]);
    await q(db, T, "select public.publish_course_version($1, 'Cambió el reglamento', true)", [course]);
    const r = await rows<{ cycle: number; state: string }>("select cycle, state from public.enrollments where user_id = $1 and course_id = $2 order by cycle", [ID.empOps2, course]);
    expect(r).toEqual([{ cycle: 1, state: "superseded" }, { cycle: 2, state: "active" }]);
    expect((await rows("select 1 from public.notifications where user_id = $1 and type = 'retraining'", [ID.empOps2])).length).toBe(1);
  });

  it("el job diario renueva lo que está por vencer y manda recordatorios de fecha límite", async () => {
    const c2 = await makeCourse("ASG-2", { validity: 12 });
    await q(db, T, "select public.create_assignment($1)", [{ course_id: c2.id, mode: "direct", user_ids: [ID.empVta, ID.empTmc], due_in_days: 7 }]);
    // Carla aprobó hace casi un año: su vigencia de 12 meses vence en ~15 días
    await db.query("update public.enrollments set result = 'passed', progress_status = 'completed', passed_at = now() - interval '350 days' where user_id = $1 and course_id = $2", [ID.empVta, c2.id]);
    const r = await one(db.query<{ j: { renewed: number; notified: number } }>("select app.daily_assignments_job() as j").then((x) => x.rows));
    expect(r.j.renewed).toBeGreaterThanOrEqual(1);
    expect((await rows("select 1 from public.notifications where user_id = $1 and type = 'due_soon'", [ID.empTmc])).length).toBe(1);
    expect((await rows<{ state: string }>("select state from public.enrollments where user_id = $1 and course_id = $2 order by cycle", [ID.empVta, c2.id])).map((x) => x.state))
      .toEqual(["superseded", "active"]);
    // Volver a correr el job no duplica avisos
    await db.query("select app.daily_assignments_job()");
    expect((await rows("select 1 from public.notifications where user_id = $1 and type = 'due_soon'", [ID.empTmc])).length).toBe(1);
  });
});

describe("Avisos", () => {
  it("cada quien ve solo sus avisos y solo puede marcarlos como leídos", async () => {
    const mine = await q<{ user_id: string }>(db, { uid: ID.empTmc }, "select user_id from public.notifications");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.user_id === ID.empTmc)).toBe(true);
    expect(await errorOf(q(db, { uid: ID.empTmc }, "update public.notifications set title = 'x'"))).toMatch(/permission denied/);
    await q(db, { uid: ID.empTmc }, "select public.mark_notifications_read()");
    expect(await q(db, { uid: ID.empTmc }, "select 1 from public.notifications where read_at is null")).toEqual([]);
  });
});
