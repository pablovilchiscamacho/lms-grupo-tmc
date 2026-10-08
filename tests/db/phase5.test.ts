import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
type Who = { uid: string; aal: "aal1" | "aal2" };
const SUPER: Who = { uid: ID.super, aal: "aal2" };
const T = { uid: ID.trainer, aal: "aal2" as const };
const HR = { uid: ID.hrEa, aal: "aal2" as const };
const MGR = { uid: ID.mgrOps, aal: "aal1" as const };
const MTY = { uid: ID.mgrMty, aal: "aal1" as const };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];

type Summary = { users: { total: number; active: number }; enrollments: Record<string, number | null>; hours: { total: number } };
type PeopleRow = { id: string; full_name: string; assigned: number; completed: number; overdue: number; failed: number; compliance: number | null };
const summary = async (who: Who, f = {}) => (await one(q<{ r: Summary }>(db, who, "select public.dashboard_summary($1) as r", [f]))).r;
const people = async (who: Who, f = {}, sort = "compliance") =>
  (await one(q<{ r: { total: number; rows: PeopleRow[] } }>(db, who, "select public.dashboard_people($1, $2) as r", [f, sort]))).r;

let course: string;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  course = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code: "DSH-1", title: "Seguridad Operativa" }]))).id;
  const v = (await one(q<{ id: string }>(db, T, "select id from public.course_versions where course_id = $1", [course]))).id;
  const m = await one(q<{ id: string }>(db, T, "select id from public.course_modules where course_version_id = $1", [v]));
  const l = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position) values ($1, 'L1', 1) returning id", [m.id]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
  await q(db, T, "select public.publish_course_version($1)", [course]);
  await q(db, T, "select public.create_assignment($1)", [{
    course_id: course, mode: "direct", due_in_days: 10,
    user_ids: [ID.empOps1, ID.empOps2, ID.empVta, ID.empTmc, ID.mgrOps],
  }]);
  // Juan y Pedro terminaron; Ana está vencida; Carla reprobó; Mario va en tiempo.
  await db.query("update public.enrollments set progress_status = 'completed', progress_pct = 100, total_seconds = 3600 where user_id = any($1)", [[ID.empOps1, ID.empTmc]]);
  await db.query("update public.enrollments set due_at = now() - interval '1 day', progress_status = 'in_progress' where user_id = $1", [ID.empOps2]);
  await db.query("update public.enrollments set result = 'failed', final_score = 50, progress_status = 'in_progress', failed_at = now() where user_id = $1", [ID.empVta]);
});

describe("KPIs por alcance", () => {
  it("Dirección / Super Admin ve todo el grupo", async () => {
    const s = await summary(SUPER);
    expect(s.enrollments).toMatchObject({ assigned: 5, completed: 2, overdue: 1, failed: 1, pending: 1, compliance: 40, failed_people: 1 });
    expect(Number(s.hours.total)).toBe(2);
  });

  it("RH de EA no ve a TMC", async () => {
    const s = await summary(HR);
    expect(s.enrollments).toMatchObject({ assigned: 4, completed: 1, compliance: 25 });
  });

  it("el jefe ve solo su línea de reporte (directos e indirectos), no a sí mismo", async () => {
    const r = await people(MGR);
    expect(r.rows.map((x) => x.id).sort()).toEqual([ID.empOps1, ID.empOps2].sort());
    expect((await summary(MGR)).enrollments).toMatchObject({ assigned: 2, completed: 1, overdue: 1 });
  });

  it("un jefe de sucursal ve a quien está en su sucursal, aunque no tenga cursos", async () => {
    const r = await people(MTY);
    expect(r.rows.map((x) => x.full_name).sort()).toEqual(["Ana López", "Laura Sucursal"]);
    expect(r.rows.find((x) => x.full_name === "Laura Sucursal")!.compliance).toBeNull();
  });

  it("un empleado sin permiso de seguimiento no puede abrir los tableros", async () => {
    const emp = { uid: ID.empVta, aal: "aal1" as const };
    expect(await errorOf(q(db, emp, "select public.dashboard_summary('{}')"))).toBe("FORBIDDEN");
    expect(await errorOf(q(db, emp, "select public.dashboard_people('{}')"))).toBe("FORBIDDEN");
    expect(await errorOf(q(db, emp, "select public.dashboard_breakdown('department', '{}')"))).toBe("FORBIDDEN");
  });
});

describe("Cumplimiento por persona", () => {
  it("semáforo: verde ≥ 90 %, rojo < 70 %; sin cursos aparte", async () => {
    expect((await people(SUPER, { light: "green" })).rows.map((x) => x.id).sort()).toEqual([ID.empOps1, ID.empTmc].sort());
    expect((await people(SUPER, { light: "red" })).total).toBe(3);
    expect((await people(SUPER, { light: "none" })).rows.every((x) => x.assigned === 0)).toBe(true);
  });

  it("filtros: solo vencidos, por departamento, por jefe y por búsqueda", async () => {
    expect((await people(SUPER, { only_overdue: true })).rows.map((x) => x.id)).toEqual([ID.empOps2]);
    expect((await people(SUPER, { department_id: ID.eaVta })).rows.map((x) => x.id)).toEqual([ID.empVta]);
    expect((await people(SUPER, { manager_id: ID.empOps1 })).rows.map((x) => x.id)).toEqual([ID.empOps2]);
    expect((await people(SUPER, { q: "lopez" })).rows.map((x) => x.id)).toEqual([ID.empOps2]);
  });

  it("con filtro de curso solo aparece quien lo tiene asignado", async () => {
    expect((await people(SUPER, { course_id: course })).total).toBe(5);
  });

  it("orden: peor cumplimiento primero, o mejor primero", async () => {
    const worst = (await people(SUPER)).rows.filter((x) => x.assigned > 0);
    expect(worst[0].compliance).toBe(0);
    const best = (await people(SUPER, {}, "-compliance")).rows;
    expect(best[0].compliance).toBe(100);
  });
});

describe("Ranking, actividad y evolución", () => {
  it("ranking de departamentos ordenado por cumplimiento", async () => {
    const r = (await one(q<{ r: { name: string; users: number; compliance: number }[] }>(db, SUPER, "select public.dashboard_breakdown('department', '{}') as r"))).r;
    expect(r.map((x) => x.name)).toEqual(["TMC · Operaciones", "EA · Operaciones", "EA · Ventas"]);
    expect(r[1]).toMatchObject({ users: 3, compliance: 33.3 });
    const byCourse = (await one(q<{ r: { failed: number; fail_rate: number }[] }>(db, HR, "select public.dashboard_breakdown('course', '{}') as r"))).r;
    expect(byCourse[0]).toMatchObject({ failed: 1, fail_rate: 100 });
  });

  it("la actividad reciente respeta el alcance", async () => {
    const all = (await one(q<{ r: { user_id: string }[] }>(db, SUPER, "select public.dashboard_activity('{}', 50) as r"))).r;
    const hr = (await one(q<{ r: { user_id: string }[] }>(db, HR, "select public.dashboard_activity('{}', 50) as r"))).r;
    expect(all.some((x) => x.user_id === ID.empTmc)).toBe(true);
    expect(hr.some((x) => x.user_id === ID.empTmc)).toBe(false);
    expect(all.some((x) => (x as unknown as { kind: string }).kind === "failed")).toBe(true);
  });

  it("la foto diaria alimenta la evolución mensual, filtrada por alcance; la tabla no se lee directo", async () => {
    await db.query("select app.compliance_snapshot_job()");
    const all = (await one(q<{ r: { assigned: number; compliance: number }[] }>(db, SUPER, "select public.dashboard_trend('{}') as r"))).r;
    expect(all.at(-1)).toMatchObject({ assigned: 5, compliance: 40 });
    const hr = (await one(q<{ r: { assigned: number }[] }>(db, HR, "select public.dashboard_trend('{}') as r"))).r;
    expect(hr.at(-1)!.assigned).toBe(4);
    expect((await one(q<{ r: unknown[] }>(db, MGR, "select public.dashboard_trend('{}') as r"))).r).toEqual([]);
    expect(await errorOf(q(db, HR, "select * from public.compliance_snapshots"))).toMatch(/permission denied/);
  });
});

describe("Filtros de los avisos", () => {
  it("vencen esta semana y reprobados llevan a las personas correctas", async () => {
    await db.query("update public.enrollments set due_at = now() + interval '3 days' where user_id = $1", [ID.mgrOps]);
    expect((await people(SUPER, { only_due_week: true })).rows.map((x) => x.id)).toEqual([ID.mgrOps]);
    expect((await people(SUPER, { only_failed: true })).rows.map((x) => x.id)).toEqual([ID.empVta]);
    expect((await summary(SUPER)).enrollments.due_week).toBe(1);
  });
});
