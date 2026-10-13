import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

/**
 * Borrar en un borrador algo que tiene «hijos» (una lección con su archivo, un módulo con lecciones, un examen con
 * preguntas al azar): el borrado en cascada no debe confundirse con una versión publicada. En una versión publicada
 * se sigue bloqueando todo.
 */
let db: PGlite;
const T = { uid: ID.trainer, aal: "aal2" as const };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
let course: string, version: string;

async function build() {
  const mod = (await one(q<{ id: string }>(db, T, "insert into public.course_modules (course_version_id, title, position) select $1, 'Módulo', coalesce(max(position), 0) + 1 from public.course_modules where course_version_id = $1 returning id", [version]))).id;
  const ids: string[] = [];
  for (const [i, t] of [[1, "PowerPoint"], [2, "PDF"]] as const) {
    const l = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position, completion_rule) values ($1, $2, $3, 'manual') returning id", [mod, t, i]))).id;
    await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
    ids.push(l);
  }
  const exam = (await one(q<{ id: string }>(db, T, "insert into public.exams (course_version_id, module_id) values ($1, $2) returning id", [version, mod]))).id;
  await q(db, T, "insert into public.exam_pools (exam_id, draw_count) values ($1, 5)", [exam]);
  return { mod, lessons: ids, exam };
}

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  course = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code: "IND-001", title: "Inducción", owner_company_id: null }]))).id;
  version = (await one(q<{ id: string }>(db, T, "select id from public.course_versions where course_id = $1", [course]))).id;
});

describe("Borrar contenido de un borrador", () => {
  it("borra una lección que tiene archivo/contenido (la lección repetida)", async () => {
    const { lessons } = await build();
    await q(db, T, "delete from public.lessons where id = $1", [lessons[0]]);
    const left = await q<{ title: string }>(db, T, "select l.title from public.lessons l where l.module_id = (select module_id from public.lessons where id = $1)", [lessons[1]]);
    expect(left.map((l) => l.title)).toEqual(["PDF"]);
  });

  it("borra un módulo con sus lecciones y un examen con sus preguntas al azar", async () => {
    const { mod, exam } = await build();
    await q(db, T, "delete from public.exams where id = $1", [exam]);
    await q(db, T, "delete from public.course_modules where id = $1", [mod]);
    expect((await db.query("select 1 from public.course_modules where id = $1", [mod])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.exam_pools where exam_id = $1", [exam])).rows).toHaveLength(0);
  });

  it("en una versión publicada sigue bloqueado borrar la lección, el módulo o el examen", async () => {
    const { mod, lessons, exam } = await build();
    await db.query("update public.course_versions set status = 'published', published_at = now() where id = $1", [version]);
    expect(await errorOf(q(db, T, "delete from public.lessons where id = $1", [lessons[1]]))).toBe("VERSION_LOCKED");
    expect(await errorOf(q(db, T, "delete from public.course_modules where id = $1", [mod]))).toBe("VERSION_LOCKED");
    expect(await errorOf(q(db, T, "delete from public.exams where id = $1", [exam]))).toBe("VERSION_LOCKED");
    expect(await errorOf(q(db, T, "delete from public.lesson_contents where lesson_id = $1", [lessons[1]]))).toBe("VERSION_LOCKED");
  });
});
