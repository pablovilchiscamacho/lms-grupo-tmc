import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

/** Celular viejo: si el visor de la presentación no abre, la lección cuenta como vista (y queda registrado). */
let db: PGlite;
const T = { uid: ID.trainer, aal: "aal2" as const };
const EMP = { uid: ID.empOps1 };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
let pdfLesson: string, textLesson: string;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  const course = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code: "IND-001", title: "Inducción", owner_company_id: null }]))).id;
  const mod = (await one(q<{ id: string }>(db, T, "select m.id from public.course_modules m join public.course_versions v on v.id = m.course_version_id where v.course_id = $1", [course]))).id;
  const pdf = (await one(db.query<{ id: string }>(`insert into public.files (bucket, storage_path, original_name, extension, mime_type, size_bytes, status, course_id, page_count)
    values ('course-content', $1::text || '/i.pdf', 'i.pdf', 'pdf', 'application/pdf', 10, 'verified', $1::uuid, 14) returning id`, [course]).then((r) => r.rows))).id;
  pdfLesson = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position, completion_rule) values ($1, 'Presentación', 1, 'all_pages') returning id", [mod]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, file_id) values ($1, 'pdf', $2)", [pdfLesson, pdf]);
  textLesson = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position, completion_rule) values ($1, 'Reglas', 2, 'manual') returning id", [mod]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [textLesson]);
  await q(db, T, "select public.publish_course_version($1, 'v1')", [course]);
  await q(db, T, "select public.admin_enroll($1, $2)", [course, [ID.empOps1]]);
});

describe("Visor que no abre en el teléfono", () => {
  it("abrir sin poder ver páginas no completa la lección", async () => {
    const r = await one(q<{ r: { pages: number; status: string } }>(db, EMP, "select public.track_lesson($1, 'open') as r", [pdfLesson]));
    expect(r.r).toMatchObject({ pages: 0, status: "viewed" });
  });

  it("al avisar que el visor falló, la lección cuenta como vista y queda en la bitácora", async () => {
    const r = await one(q<{ r: { status: string } }>(db, EMP, "select public.track_lesson($1, 'viewer_failed') as r", [pdfLesson]));
    expect(r.r.status).toBe("completed");
    expect((await db.query("select 1 from audit.audit_logs where action = 'lesson.viewer_failed' and entity_id = $1", [pdfLesson])).rows).toHaveLength(1);
  });

  it("no sirve para saltarse lecciones que no son presentaciones, ni acepta otros eventos", async () => {
    await q(db, EMP, "select public.track_lesson($1, 'open')", [textLesson]);
    const r = await one(q<{ r: { status: string } }>(db, EMP, "select public.track_lesson($1, 'viewer_failed') as r", [textLesson]));
    expect(r.r.status).toBe("viewed");
    expect(await errorOf(q(db, EMP, "select public.track_lesson($1, 'otro')", [textLesson]))).toBe("VALIDATION");
  });
});
