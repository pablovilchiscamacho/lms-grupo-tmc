import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
const T = { uid: ID.trainer, aal: "aal2" as const };
const EMP = { uid: ID.empOps1 };
const TOKEN = "token-dispositivo-a-0123456789";
const one = async <R,>(p: Promise<R[]>) => (await p)[0];

type Snap = { type: string; prompt: string; options: { id: string; text: string }[]; targets?: { id: string; text: string }[] };
type Payload = { attempt_id: string; resumed: boolean; questions: { id: string; snapshot: Snap }[] };

let course: string, version: string, lesson: string, exam: string, q1: string;

async function saveQ(p: Record<string, unknown>) {
  return (await one(q<{ id: string }>(db, T, "select public.save_question($1) as id", [p]))).id;
}

async function start(uid = ID.empOps1, token = TOKEN) {
  return (await one(q<{ r: Payload }>(db, { uid }, "select public.start_attempt($1, $2) as r", [exam, token]))).r;
}

/** Responde todo; "perfect" = todo correcto. */
async function answerAll(p: Payload, perfect: boolean) {
  const byPrompt = (s: string) => p.questions.find((x) => x.snapshot.prompt.startsWith(s))!;
  const opt = (s: string, t: string) => byPrompt(s).snapshot.options.find((o) => o.text === t)!.id;
  const save = (qid: string, resp: unknown) => q(db, EMP, "select public.save_answer($1, $2, $3, $4)", [p.attempt_id, qid, resp, TOKEN]);
  await save(byPrompt("¿2+2").id, { option_id: opt("¿2+2", "4") });
  await save(byPrompt("Elige").id, { option_ids: perfect ? [opt("Elige", "A"), opt("Elige", "B")] : [opt("Elige", "A"), opt("Elige", "B"), opt("Elige", "C")] });
  await save(byPrompt("El cielo").id, { option_id: opt("El cielo", "Verdadero") });
  await save(byPrompt("Capital").id, { text: "  queretaro " });
  const ord = byPrompt("Ordena");
  await save(ord.id, { order: ["uno", "dos", "tres"].map((t) => ord.snapshot.options.find((o) => o.text === t)!.id) });
  const m = byPrompt("Relaciona");
  const left = (t: string) => m.snapshot.options.find((o) => o.text === t)!.id;
  const right = (t: string) => m.snapshot.targets!.find((o) => o.text === t)!.id;
  await save(m.id, { pairs: perfect ? { [left("Perro")]: right("Ladra"), [left("Gato")]: right("Maúlla") } : { [left("Perro")]: right("Maúlla"), [left("Gato")]: right("Ladra") } });
  await save(byPrompt("¿Qué tan").id, { value: 4 });
  await save(byPrompt("Explica").id, { text: "Porque es importante reportar." });
}

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  course = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code: "EXA-1", title: "Curso con examen" }]))).id;
  version = (await one(q<{ id: string }>(db, T, "select id from public.course_versions where course_id = $1", [course]))).id;
  const mod = await one(q<{ id: string }>(db, T, "select id from public.course_modules where course_version_id = $1", [version]));
  lesson = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position) values ($1, 'Lectura', 1) returning id", [mod.id]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>Lee</p>')", [lesson]);
  exam = (await one(q<{ id: string }>(db, T,
    "insert into public.exams (course_version_id, title, time_limit_minutes, max_attempts, passing_score, shuffle_questions, shuffle_options, show_correct_answers) values ($1, 'Examen final', 30, 3, 80, false, false, true) returning id", [version]))).id;
});

describe("Banco de preguntas", () => {
  it("valida cada tipo antes de guardar", async () => {
    expect(await errorOf(q(db, T, "select public.save_question($1)", [{ type: "single_choice", prompt: "Mal", options: [{ text: "a", is_correct: true }, { text: "b", is_correct: true }] }])))
      .toBe("QUESTION_INVALID");
    expect(await errorOf(q(db, T, "select public.save_question($1)", [{ type: "short_text", prompt: "Sin respuestas", config: { accepted: [] } }])))
      .toBe("QUESTION_INVALID");
  });

  it("crea los 8 tipos y los agrega al examen", async () => {
    q1 = await saveQ({ type: "single_choice", prompt: "¿2+2?", options: [{ text: "3" }, { text: "4", is_correct: true }] });
    const ids = [q1,
      await saveQ({ type: "multiple_choice", prompt: "Elige las vocales A y B", scoring: "partial", options: [{ text: "A", is_correct: true }, { text: "B", is_correct: true }, { text: "C" }, { text: "D" }] }),
      await saveQ({ type: "true_false", prompt: "El cielo es azul", tf_answer: true }),
      await saveQ({ type: "short_text", prompt: "Capital del estado", config: { accepted: ["Querétaro"] } }),
      await saveQ({ type: "ordering", prompt: "Ordena", options: [{ text: "uno" }, { text: "dos" }, { text: "tres" }] }),
      await saveQ({ type: "matching", prompt: "Relaciona", options: [{ text: "Perro", match_target: "Ladra" }, { text: "Gato", match_target: "Maúlla" }] }),
      await saveQ({ type: "scale", prompt: "¿Qué tan útil fue?", config: { min: 1, max: 5 } }),
      await saveQ({ type: "open_text", prompt: "Explica por qué", config: { rubric: "Menciona el reporte" } }),
    ];
    let pos = 1;
    for (const id of ids) await q(db, T, "insert into public.exam_items (exam_id, question_id, position) values ($1, $2, $3)", [exam, id, pos++]);
    expect((await one(q<{ i: string[] }>(db, T, "select public.version_publish_issues($1) as i", [version]))).i).toEqual([]);
    await q(db, T, "select public.publish_course_version($1)", [course]);
    await q(db, T, "select public.admin_enroll($1, $2)", [course, [ID.empOps1, ID.empOps2]]);
  });

  it("un empleado no puede leer el banco de preguntas", async () => {
    expect(await q(db, EMP, "select id from public.questions")).toEqual([]);
    expect(await q(db, EMP, "select id from public.question_options")).toEqual([]);
  });

  it("una pregunta ya publicada no se edita: se crea una revisión", async () => {
    const newId = await saveQ({ id: q1, type: "single_choice", prompt: "¿2+2? (revisada)", options: [{ text: "3" }, { text: "4", is_correct: true }] });
    expect(newId).not.toBe(q1);
    const rows = await db.query<{ id: string; is_current: boolean }>("select id, is_current from public.questions where id in ($1, $2) order by revision", [q1, newId]);
    expect(rows.rows).toEqual([{ id: q1, is_current: false }, { id: newId, is_current: true }]);
    // El examen publicado sigue usando la original
    expect((await db.query("select 1 from public.exam_items where exam_id = $1 and question_id = $2", [exam, q1])).rows.length).toBe(1);
  });
});

describe("Presentar el examen", () => {
  let attempt: Payload;

  it("no se puede presentar sin terminar el contenido", async () => {
    expect(await errorOf(start())).toBe("CONTENT_NOT_COMPLETE");
    await q(db, EMP, "select public.track_lesson($1, 'open')", [lesson]);
    await q(db, EMP, "select public.complete_lesson($1)", [lesson]);
  });

  it("al iniciar recibe las preguntas sin respuestas correctas", async () => {
    attempt = await start();
    expect(attempt.resumed).toBe(false);
    expect(attempt.questions.length).toBe(8);
    const raw = JSON.stringify(attempt.questions);
    expect(raw).not.toMatch(/is_correct|correct|accepted|pairs|"order"/);
    expect(await errorOf(q(db, EMP, "select * from app.attempt_question_keys"))).toMatch(/permission denied/);
    expect(await q(db, EMP, "select id from public.exam_attempts")).toEqual([]);
  });

  it("volver a entrar reanuda el mismo intento; otro dispositivo toma el control", async () => {
    const again = await start();
    expect(again).toMatchObject({ attempt_id: attempt.attempt_id, resumed: true });
    const other = await start(ID.empOps1, "token-dispositivo-b-0123456789");
    expect(other.attempt_id).toBe(attempt.attempt_id);
    const qid = attempt.questions[0].id;
    expect(await errorOf(q(db, EMP, "select public.save_answer($1, $2, $3, $4)", [attempt.attempt_id, qid, { option_id: attempt.questions[0].snapshot.options[0].id }, TOKEN])))
      .toBe("SESSION_CONFLICT");
    await start(); // el dispositivo A lo recupera
    const ev = await db.query<{ type: string }>("select type from public.attempt_events where attempt_id = $1 order by id", [attempt.attempt_id]);
    expect(ev.rows.map((r) => r.type)).toEqual(["started", "resumed", "session_takeover", "session_takeover"]);
  });

  it("rechaza respuestas con ids que no son de la pregunta", async () => {
    expect(await errorOf(q(db, EMP, "select public.save_answer($1, $2, $3, $4)",
      [attempt.attempt_id, attempt.questions[0].id, { option_id: "00000000-0000-4000-8000-000000000000" }, TOKEN]))).toBe("RESPONSE_INVALID");
  });

  it("califica automáticamente lo cerrado y deja en revisión lo abierto", async () => {
    await answerAll(attempt, false);
    await q(db, EMP, "select public.submit_attempt($1, $2)", [attempt.attempt_id, TOKEN]);
    const a = await one(db.query<{ status: string; auto_points: string; max_points: string }>(
      "select status, auto_points, max_points from public.exam_attempts where id = $1", [attempt.attempt_id]).then((r) => r.rows));
    // 10 (2+2) + 5 (parcial: 2 aciertos − 1 error) + 10 (V/F) + 10 (texto, sin acentos ni mayúsculas) + 10 (orden) + 0 (relacionar mal) + 0 (escala) = 45 de 70
    expect(a).toEqual({ status: "pending_review", auto_points: "45.00", max_points: "70.00" });
    const e = await one(db.query<{ result: string }>("select result from public.enrollments where user_id = $1 and course_id = $2", [ID.empOps1, course]).then((r) => r.rows));
    expect(e.result).toBe("pending_review");
    expect(await errorOf(start())).toBe("ATTEMPT_PENDING_REVIEW");
  });

  it("el evaluador ve la bandeja y califica; el empleado no puede calificarse ni RH calificar", async () => {
    const list = await one(q<{ r: { answer_id: string; response: string }[] }>(db, T, "select public.pending_reviews() as r"));
    expect(list.r).toHaveLength(1);
    expect(list.r[0].response).toBe("Porque es importante reportar.");
    expect(await errorOf(q(db, EMP, "select public.grade_answer($1, 100)", [list.r[0].answer_id]))).toBe("FORBIDDEN");
    expect(await errorOf(q(db, { uid: ID.hrEa, aal: "aal2" }, "select public.grade_answer($1, 100)", [list.r[0].answer_id]))).toBe("FORBIDDEN");
    await q(db, T, "select public.grade_answer($1, 100, 'Bien argumentado')", [list.r[0].answer_id]);
    const a = await one(db.query<{ status: string; score_pct: string; passed: boolean }>("select status, score_pct, passed from public.exam_attempts where id = $1", [attempt.attempt_id]).then((r) => r.rows));
    expect(a).toEqual({ status: "graded", score_pct: "78.57", passed: false }); // 55/70 < 80
  });

  it("el empleado ve su resultado y la retroalimentación según la configuración", async () => {
    const r = await one(q<{ r: { score_pct: string; passed: boolean; review: { feedback: string | null; answer_key: unknown }[] } }>(db, EMP, "select public.my_attempt_result($1) as r", [attempt.attempt_id]));
    expect(Number(r.r.score_pct)).toBeCloseTo(78.57, 2);
    expect(r.r.passed).toBe(false);
    expect(r.r.review.some((x) => x.feedback === "Bien argumentado")).toBe(true);
    expect(r.r.review[0].answer_key).toBeTruthy(); // show_correct_answers = true
  });

  it("segundo intento perfecto: aprueba el curso con la mejor calificación", async () => {
    attempt = await start();
    await answerAll(attempt, true);
    await q(db, EMP, "select public.submit_attempt($1, $2)", [attempt.attempt_id, TOKEN]);
    const list = await one(q<{ r: { answer_id: string }[] }>(db, T, "select public.pending_reviews() as r"));
    await q(db, T, "select public.grade_answer($1, 100)", [list.r[0].answer_id]);
    const e = await one(db.query<{ result: string; final_score: string; progress_status: string; progress_pct: string }>(
      "select result, final_score, progress_status, progress_pct from public.enrollments where user_id = $1 and course_id = $2", [ID.empOps1, course]).then((r) => r.rows));
    expect(e).toEqual({ result: "passed", final_score: "100.00", progress_status: "completed", progress_pct: "100.00" });
    expect(await errorOf(start())).toBe("ALREADY_PASSED");
  });

  it("recalificar una respuesta automática exige permiso de corrección y motivo", async () => {
    const ans = await one(db.query<{ id: string }>("select an.id from public.attempt_answers an join public.attempt_questions q on q.id = an.attempt_question_id where an.attempt_id = $1 and q.snapshot->>'type' = 'single_choice'", [attempt.attempt_id]).then((r) => r.rows));
    expect(await errorOf(q(db, T, "select public.grade_answer($1, 0)", [ans.id]))).toBe("VALIDATION");
    await q(db, T, "select public.grade_answer($1, 0, 'Corrección: pregunta mal planteada')", [ans.id]);
    const n = await db.query("select is_override from public.manual_grades where answer_id = $1", [ans.id]);
    expect(n.rows).toEqual([{ is_override: true }]);
  });
});

describe("Tiempo e intentos", () => {
  it("con el tiempo vencido no se guardan respuestas y el intento se cierra solo", async () => {
    await q(db, { uid: ID.empOps2 }, "select public.track_lesson($1, 'open')", [lesson]);
    await q(db, { uid: ID.empOps2 }, "select public.complete_lesson($1)", [lesson]);
    const p = (await one(q<{ r: Payload }>(db, { uid: ID.empOps2 }, "select public.start_attempt($1, $2) as r", [exam, TOKEN]))).r;
    await db.query("update public.exam_attempts set deadline_at = now() - interval '5 minutes' where id = $1", [p.attempt_id]);
    const r = await one(q<{ r: { closed: boolean; expired: boolean } }>(db, { uid: ID.empOps2 }, "select public.save_answer($1, $2, $3, $4) as r",
      [p.attempt_id, p.questions[0].id, { option_id: p.questions[0].snapshot.options[0].id }, TOKEN]));
    expect(r.r).toEqual({ closed: true, expired: true });
    const a = await one(db.query<{ submitted_by: string; status: string }>("select submitted_by, status from public.exam_attempts where id = $1", [p.attempt_id]).then((x) => x.rows));
    expect(a).toEqual({ submitted_by: "timeout", status: "graded" }); // abierta vacía = 0, no requiere revisión
  });

  it("el job de cierre entrega los intentos vencidos aunque nadie tenga la página abierta", async () => {
    const p = (await one(q<{ r: Payload }>(db, { uid: ID.empOps2 }, "select public.start_attempt($1, $2) as r", [exam, TOKEN]))).r;
    await db.query("update public.exam_attempts set deadline_at = now() - interval '2 minutes' where id = $1", [p.attempt_id]);
    expect((await db.query<{ n: number }>("select app.close_expired_attempts() as n")).rows[0].n).toBe(1);
  });

  it("al agotar los intentos sin aprobar, el curso queda reprobado", async () => {
    const p = (await one(q<{ r: Payload }>(db, { uid: ID.empOps2 }, "select public.start_attempt($1, $2) as r", [exam, TOKEN]))).r;
    await q(db, { uid: ID.empOps2 }, "select public.submit_attempt($1, $2)", [p.attempt_id, TOKEN]);
    expect(await errorOf(q(db, { uid: ID.empOps2 }, "select public.start_attempt($1, $2)", [exam, TOKEN]))).toBe("NO_ATTEMPTS_LEFT");
    const e = await one(db.query<{ result: string }>("select result from public.enrollments where user_id = $1 and course_id = $2", [ID.empOps2, course]).then((r) => r.rows));
    expect(e.result).toBe("failed");
  });

  it("el empleado ve sus intentos con la información permitida", async () => {
    const enr = await one(db.query<{ id: string }>("select id from public.enrollments where user_id = $1 and course_id = $2", [ID.empOps2, course]).then((r) => r.rows));
    const r = await one(q<{ r: { used: number; can_retry: boolean; attempts: unknown[] }[] }>(db, { uid: ID.empOps2 }, "select public.my_course_exams($1) as r", [enr.id]));
    expect(r.r[0]).toMatchObject({ used: 3, can_retry: false });
    expect(r.r[0].attempts).toHaveLength(3);
  });

  it("un intento anulado no cuenta y se puede volver a presentar", async () => {
    const a = await one(db.query<{ id: string }>("select id from public.exam_attempts where user_id = $1 order by attempt_number desc limit 1", [ID.empOps2]).then((r) => r.rows));
    expect(await errorOf(q(db, T, "select public.void_attempt($1, '')", [a.id]))).toBe("VALIDATION");
    await q(db, T, "select public.void_attempt($1, 'Falla eléctrica en la sucursal')", [a.id]);
    const p = (await one(q<{ r: Payload }>(db, { uid: ID.empOps2 }, "select public.start_attempt($1, $2) as r", [exam, TOKEN]))).r;
    expect(p.resumed).toBe(false);
  });
});

describe("Versiones con examen", () => {
  it("la versión nueva copia el examen y el publicado no se puede editar", async () => {
    expect(await errorOf(q(db, T, "update public.exams set passing_score = 50 where id = $1", [exam]))).toBe("VERSION_LOCKED");
    await q(db, T, "update public.exams set is_active = false where id = $1", [exam]); // lo operativo sí
    const v2 = (await one(q<{ id: string }>(db, T, "select public.create_draft_version($1) as id", [course]))).id;
    const n = await db.query<{ n: number }>("select count(*)::int n from public.exam_items i join public.exams e on e.id = i.exam_id where e.course_version_id = $1", [v2]);
    expect(n.rows[0].n).toBe(8);
  });
});
