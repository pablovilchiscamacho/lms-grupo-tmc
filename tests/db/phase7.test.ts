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
const EMP: Who = { uid: ID.empVta, aal: "aal1" };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
type Rep = { total: number; rows: Record<string, unknown>[] };
const report = async (who: Who, key: string, f: object = {}, limit = 100, offset = 0) =>
  (await one(q<{ r: Rep }>(db, who, "select public.report($1, $2, $3, $4) as r", [key, f, limit, offset]))).r;

const KEYS = ["users", "courses", "compliance", "grades", "exams", "overdue", "failed", "hours", "certificates", "activity"];
let course: string;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  course = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code: "REP-1", title: "Seguridad Industrial" }]))).id;
  const v = (await one(q<{ id: string }>(db, T, "select id from public.course_versions where course_id = $1", [course]))).id;
  const m = await one(q<{ id: string }>(db, T, "select id from public.course_modules where course_version_id = $1", [v]));
  const l = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position) values ($1, 'L1', 1) returning id", [m.id]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
  await q(db, T, "select public.publish_course_version($1)", [course]);
  await q(db, T, "select public.create_assignment($1)", [{ course_id: course, mode: "direct", due_in_days: 10, user_ids: [ID.empOps1, ID.empOps2, ID.empVta, ID.empTmc] }]);
  // Juan termina de verdad (genera constancia); Ana vencida; Carla reprobada; Pedro (TMC) pendiente.
  await q(db, { uid: ID.empOps1, aal: "aal1" }, "select public.track_lesson($1, 'open')", [l]);
  await q(db, { uid: ID.empOps1, aal: "aal1" }, "select public.complete_lesson($1)", [l]);
  await db.query("update public.enrollments set due_at = now() - interval '3 days', progress_status = 'in_progress' where user_id = $1", [ID.empOps2]);
  await db.query("update public.enrollments set result = 'failed', final_score = 40, failed_at = now(), progress_status = 'in_progress' where user_id = $1", [ID.empVta]);
});

describe("Los 10 reportes", () => {
  it("todos responden para quien tiene permiso", async () => {
    for (const k of KEYS) {
      const r = await report(SUPER, k);
      if (k !== "exams") expect(r.total, k).toBeGreaterThan(0);   // este curso no tiene examen (los intentos se prueban en la Fase 3)
      expect(Array.isArray(r.rows), k).toBe(true);
    }
  });

  it("vencidos, reprobados, calificaciones y certificados traen a las personas correctas", async () => {
    expect((await report(SUPER, "overdue")).rows.map((r) => r.nombre)).toEqual(["Ana López"]);
    expect((await report(SUPER, "overdue")).rows[0].dias_atraso).toBeGreaterThanOrEqual(2);
    expect((await report(SUPER, "failed")).rows.map((r) => r.nombre)).toEqual(["Carla Ventas"]);
    expect((await report(SUPER, "certificates")).rows.map((r) => r.nombre)).toEqual(["Juan Pérez"]);
    expect((await report(SUPER, "grades", { status: "failed" })).rows.map((r) => r.nombre)).toEqual(["Carla Ventas"]);
    const c = (await report(SUPER, "courses", { course_id: course })).rows[0];
    expect(c).toMatchObject({ clave: "REP-1", asignados: 4, completados: 1, vencidos: 1, reprobados: 1, cumplimiento: 25 });
  });

  it("paginación: el total no cambia y las páginas no se repiten", async () => {
    const all = await report(SUPER, "users", {}, 100, 0);
    const p1 = await report(SUPER, "users", {}, 3, 0);
    const p2 = await report(SUPER, "users", {}, 3, 3);
    expect(p1.total).toBe(all.total);
    expect(p1.rows).toHaveLength(3);
    expect([...p1.rows, ...p2.rows].map((r) => r.nombre)).toEqual(all.rows.slice(0, 6).map((r) => r.nombre));
  });

  it("la actividad registra asignaciones, avance, aprobación y constancia", async () => {
    const kinds = new Set((await report(SUPER, "activity")).rows.map((r) => r.evento));
    for (const k of ["assigned", "started", "completed", "certificate_issued", "failed"]) expect(kinds.has(k), k).toBe(true);
  });
});

describe("Alcance", () => {
  it("RH de EA no ve a TMC en ningún reporte", async () => {
    for (const k of KEYS) {
      const r = await report(HR, k, {}, 1000);
      expect(JSON.stringify(r.rows), k).not.toContain("Pedro");
    }
  });

  it("el jefe solo ve su línea de reporte", async () => {
    const names = new Set((await report(MGR, "users", {}, 1000)).rows.map((r) => r.nombre));
    expect([...names].sort()).toEqual(["Ana López", "Juan Pérez"]);
    expect((await report(MGR, "failed")).total).toBe(0);
  });

  it("un empleado sin permiso de reportes no puede consultarlos ni exportarlos", async () => {
    expect(await errorOf(q(db, EMP, "select public.report('users', '{}')"))).toBe("FORBIDDEN");
    expect(await errorOf(q(db, EMP, "select public.log_report_export('users', 'csv', '{}', 1)"))).toBe("FORBIDDEN");
  });
});

describe("Exportación y expediente", () => {
  it("cada exportación queda en la bitácora con filtros y filas", async () => {
    await q(db, HR, "select public.log_report_export('compliance', 'xlsx', $1, 7)", [{ department_id: ID.eaOps }]);
    const [log] = (await db.query<{ action: string; new_data: { report: string; rows: number; filters: object } }>(
      "select action, new_data from audit.audit_logs where action = 'report.exported' order by id desc limit 1")).rows;
    expect(log.new_data).toMatchObject({ report: "compliance", rows: 7, filters: { department_id: ID.eaOps } });
    expect(await errorOf(q(db, HR, "select public.log_report_export('users', 'docx', '{}', 1)"))).toBe("VALIDATION");
  });

  it("el expediente de una persona: su jefe y RH sí; otra empresa o un compañero no", async () => {
    const r = (await one(q<{ r: { person: { full_name: string }; courses: unknown[]; certificates: unknown[] } }>(db, MGR, "select public.training_record($1) as r", [ID.empOps1]))).r;
    expect(r.person.full_name).toBe("Juan Pérez");
    expect(r.courses).toHaveLength(1);
    expect(r.certificates).toHaveLength(1);
    expect(await errorOf(q(db, HR, "select public.training_record($1)", [ID.empTmc]))).toBe("FORBIDDEN");
    expect(await errorOf(q(db, EMP, "select public.training_record($1)", [ID.empOps1]))).toBe("FORBIDDEN");
    expect((await one(q<{ r: { person: object } }>(db, EMP, "select public.training_record($1) as r", [ID.empVta]))).r.person).toBeTruthy();
  });
});
