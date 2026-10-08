import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
type Who = { uid: string; aal: "aal1" | "aal2" };
const T: Who = { uid: ID.trainer, aal: "aal2" };
const SUPER: Who = { uid: ID.super, aal: "aal2" };
const HR: Who = { uid: ID.hrEa, aal: "aal2" };
const EMP: Who = { uid: ID.empVta, aal: "aal1" };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
const rows = async <R,>(sql: string, params: unknown[] = []) => (await db.query<R>(sql, params)).rows;
type Outbox = { id: string; to_email: string; template_key: string; status: string; attempts: number; request_id: number | null; batch_index: number | null; provider_id: string | null; subject: string };
const outbox = () => rows<Outbox>("select * from public.email_outbox order by created_at, to_email");
const dispatch = async () => (await one(rows<{ r: Record<string, unknown> }>("select app.dispatch_emails() as r"))).r;

let course: string, exam: string, version: string;

async function makeCourse(code: string, withExam = false) {
  const id = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code, title: `Curso ${code}` }]))).id;
  const v = (await one(q<{ id: string }>(db, T, "select id from public.course_versions where course_id = $1", [id]))).id;
  const m = await one(q<{ id: string }>(db, T, "select id from public.course_modules where course_version_id = $1", [v]));
  const l = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position) values ($1, 'L1', 1) returning id", [m.id]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
  let ex: string | undefined;
  if (withExam) {
    ex = (await one(q<{ id: string }>(db, T, "insert into public.exams (course_version_id, max_attempts, passing_score) values ($1, 2, 80) returning id", [v]))).id;
    const qid = (await one(q<{ id: string }>(db, T, "select public.save_question($1) as id", [{ type: "true_false", prompt: "¿Es seguro?", tf_answer: true }]))).id;
    await q(db, T, "insert into public.exam_items (exam_id, question_id) values ($1, $2)", [ex, qid]);
  }
  await q(db, T, "select public.publish_course_version($1)", [id]);
  return { id, exam: ex, version: v };
}

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  const c = await makeCourse("MAIL-1", true);
  course = c.id; exam = c.exam!; version = c.version;
});

describe("Encolado", () => {
  it("con el correo desactivado no se encola nada", async () => {
    await q(db, T, "select public.create_assignment($1)", [{ course_id: course, mode: "direct", user_ids: [ID.empTmc], due_in_days: 10 }]);
    expect(await outbox()).toHaveLength(0);
  });

  it("al activarlo, cada aviso sale por correo a quien tiene correo real (Ana no tiene) y solo de los tipos encendidos", async () => {
    await q(db, SUPER, "select public.save_notification_settings($1, null)", [{ enabled: true, from: "Capacitación <capacitacion@grupotmc.test>", types: { cancelled: false } }]);
    await q(db, T, "select public.create_assignment($1)", [{ course_id: course, mode: "direct", user_ids: [ID.empOps1, ID.empOps2, ID.empVta], due_in_days: 10 }]);
    const o = await outbox();
    expect(o.map((x) => x.to_email).sort()).toEqual(["carla@ea.test", "juan@ea.test"]);
    expect(o.every((x) => x.template_key === "course_assigned" && x.status === "pending")).toBe(true);
    const e = await one(rows<{ id: string }>("select id from public.enrollments where user_id = $1", [ID.empVta]));
    await q(db, T, "select public.cancel_enrollment($1, 'Cambio de área')", [e.id]);
    expect((await outbox()).filter((x) => x.template_key === "cancelled")).toHaveLength(0);
  });

  it("la plantilla escapa el contenido (sin HTML inyectado) y lleva el botón a la plataforma", async () => {
    const h = (await one(rows<{ h: string }>("select app.email_html('Juan', '<script>x</script>', 'Línea 1\nLínea 2', 'https://lms.test/cursos/1') as h"))).h;
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("Línea 1<br>Línea 2");
    expect(h).toContain('href="https://lms.test/cursos/1"');
  });
});

describe("Envío a Resend", () => {
  it("sin clave no se manda nada", async () => {
    expect((await dispatch()).note).toBe("sin clave de Resend");
    expect(await rows("select 1 from net.http_requests_log")).toHaveLength(0);
  });

  it("con clave manda un lote; al responder 200 quedan enviados con su id del proveedor", async () => {
    await db.query("select vault.create_secret('re_test_123', 'resend_api_key')");
    const r = await dispatch();
    expect(r.queued).toBe(2);
    const [req] = await rows<{ id: number; url: string; body: unknown[]; headers: Record<string, string> }>("select * from net.http_requests_log");
    expect(req.url).toBe("https://api.resend.com/emails/batch");
    expect(req.body).toHaveLength(2);
    expect(req.headers.Authorization).toBe("Bearer re_test_123");
    expect((req.body[0] as { from: string }).from).toContain("capacitacion@grupotmc.test");
    expect((await outbox()).every((x) => x.status === "sending" && Number(x.request_id) === Number(req.id))).toBe(true);
    await db.query("insert into net._http_response (id, status_code, content) values ($1, 200, $2)", [req.id, JSON.stringify({ data: [{ id: "em_1" }, { id: "em_2" }] })]);
    expect((await dispatch()).sent).toBe(2);
    const o = await outbox();
    expect(o.map((x) => [x.status, x.provider_id]).sort()).toEqual([["sent", "em_1"], ["sent", "em_2"]]);
  });

  it("si el proveedor rechaza, se reintenta después y uno por uno; tras 4 intentos queda fallido", async () => {
    const id = (await one(q<{ id: string }>(db, SUPER, "select public.send_test_email('mal@grupotmc.test') as id"))).id;
    await dispatch();
    let o = (await outbox()).find((x) => x.id === id)!;
    await db.query("insert into net._http_response (id, status_code, content) values ($1, 422, '{\"message\":\"invalid\"}')", [o.request_id]);
    await dispatch();
    o = (await outbox()).find((x) => x.id === id)!;
    expect(o).toMatchObject({ status: "pending", attempts: 1 });
    for (let i = 0; i < 3; i++) {
      await db.query("update public.email_outbox set scheduled_at = now() - interval '1 minute' where id = $1", [id]);
      await dispatch();
      o = (await outbox()).find((x) => x.id === id)!;
      const [last] = await rows<{ body: unknown[] }>("select body from net.http_requests_log order by id desc limit 1");
      expect(last.body).toHaveLength(1);
      await db.query("insert into net._http_response (id, status_code, content) values ($1, 500, 'error')", [o.request_id]);
      await dispatch();
    }
    expect((await outbox()).find((x) => x.id === id)!.status).toBe("failed");
  });
});

describe("Avisos nuevos", () => {
  it("un examen que pasa a revisión avisa a quien califica (sin instructores: a Capacitación del grupo)", async () => {
    const e = await one(rows<{ id: string }>("select id from public.enrollments where user_id = $1 and course_id = $2", [ID.empOps1, course]));
    await db.query("update public.enrollments set course_version_id = $2 where id = $1", [e.id, version]);
    const a = (await one(rows<{ id: string }>(`insert into public.exam_attempts (exam_id, enrollment_id, user_id, attempt_number, status, session_token_hash, random_seed)
      values ($1, $2, $3, 1, 'submitted', 'x', 0.5) returning id`, [exam, e.id, ID.empOps1]))).id;
    await db.query("update public.exam_attempts set status = 'pending_review' where id = $1", [a]);
    const n = await rows<{ user_id: string }>("select user_id from public.notifications where type = 'review_pending'");
    expect(n.map((x) => x.user_id).sort()).toEqual([ID.super, ID.trainer].sort());
  });

  it("recordatorios configurables y resumen semanal del jefe con su equipo atrasado", async () => {
    await q(db, T, "select public.save_notification_settings(null, $1)", [{ days_before: [5, 2], overdue: true, overdue_every_days: 7, manager_digest: true }]);
    await db.query("update public.enrollments set due_at = app.end_of_day(app.local_today('America/Mexico_City') + 5, 'America/Mexico_City') where user_id = $1 and state = 'active'", [ID.empTmc]);
    await db.query("update public.enrollments set due_at = now() - interval '3 days' where user_id = $1 and state = 'active'", [ID.empOps2]);
    await db.query("select app.daily_assignments_job(true)");
    expect(await rows("select 1 from public.notifications where user_id = $1 and type = 'due_soon'", [ID.empTmc])).toHaveLength(1);
    const d = await rows<{ user_id: string; title: string }>("select user_id, title from public.notifications where type = 'team_overdue'");
    expect(d.map((x) => x.user_id)).toEqual([ID.mgrOps]);   // Juan es jefe de Ana, pero no tiene permiso de seguimiento
    expect(d[0].title).toBe("1 persona de tu equipo tiene cursos vencidos");
    await db.query("select app.daily_assignments_job(true)");
    expect(await rows("select 1 from public.notifications where type = 'team_overdue'")).toHaveLength(1);
    expect(await errorOf(q(db, T, "select public.save_notification_settings(null, $1)", [{ days_before: [90] }]))).toBe("VALIDATION");
  });
});

describe("Permisos", () => {
  it("solo quien administra notificaciones ve el estado, cambia la configuración o manda pruebas", async () => {
    for (const who of [EMP, HR]) {
      expect(await errorOf(q(db, who, "select public.email_status()"))).toBe("FORBIDDEN");
      expect(await errorOf(q(db, who, "select public.save_notification_settings('{\"enabled\":false}', null)"))).toBe("FORBIDDEN");
      expect(await errorOf(q(db, who, "select public.send_test_email('x@y.test')"))).toBe("FORBIDDEN");
    }
    expect(await q(db, EMP, "select * from public.email_outbox")).toHaveLength(0);
    const s = (await one(q<{ s: { has_key: boolean } }>(db, T, "select public.email_status() as s"))).s;
    expect(s.has_key).toBe(true);
    expect(JSON.stringify(s)).not.toContain("re_test_123");
  });
});
