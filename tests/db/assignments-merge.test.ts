import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

/** «Personas específicas» se suman a la asignación existente del curso; «Agregar personas» a una asignación. */
let db: PGlite;
const T = { uid: ID.trainer, aal: "aal2" as const };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
let course: string;
type R = { assignment_id: string; created: number; skipped: number; merged: boolean };
const assign = async (p: object) => (await one(q<{ r: R }>(db, T, "select public.create_assignment($1) as r", [{ course_id: course, ...p }]))).r;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  course = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code: "IND-001", title: "Inducción", owner_company_id: null }]))).id;
  const mod = (await one(q<{ id: string }>(db, T, "select m.id from public.course_modules m join public.course_versions v on v.id = m.course_version_id where v.course_id = $1", [course]))).id;
  const l = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position, completion_rule) values ($1, 'Bienvenida', 1, 'on_view') returning id", [mod]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
  await q(db, T, "select public.publish_course_version($1, 'v1')", [course]);
});

describe("Asignaciones sin cuadros repetidos", () => {
  it("asignar el mismo curso a otras personas con las mismas condiciones las suma a la misma asignación", async () => {
    const a = await assign({ mode: "direct", user_ids: [ID.empOps1], due_in_days: 15 });
    const b = await assign({ mode: "direct", user_ids: [ID.empOps2, ID.empVta], due_in_days: 15 });
    expect(b).toMatchObject({ assignment_id: a.assignment_id, merged: true, created: 2 });
    const n = await db.query<{ n: number }>("select count(*)::int n from public.assignments where course_id = $1", [course]);
    expect(n.rows[0].n).toBe(1);
  });

  it("con otras condiciones (otra fecha límite) sí crea otra asignación", async () => {
    const c = await assign({ mode: "direct", user_ids: [ID.mgrOps], due_in_days: 30 });
    expect(c.merged).toBe(false);
  });

  it("«Agregar personas» suma a una asignación existente y no duplica a quien ya lo tiene", async () => {
    const a = (await one(db.query<{ id: string }>("select id from public.assignments where course_id = $1 and due_in_days = 15", [course]).then((r) => r.rows))).id;
    const r = await one(q<{ r: { created: number; skipped: number } }>(db, T, "select public.add_to_assignment($1, $2) as r", [a, [ID.mgrMty, ID.empOps1]]));
    expect(r.r).toMatchObject({ created: 1, skipped: 1 });
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "select public.add_to_assignment($1, $2)", [a, [ID.empTmc]]))).toBe("FORBIDDEN");
  });
});
