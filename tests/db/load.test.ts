import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

/**
 * Prueba de carga de los tableros (criterio de la Fase 5): 5 000 personas y 100 000 inscripciones sintéticas.
 * No corre con el resto: `LOAD=1 npx vitest run tests/db/load.test.ts`.
 * PGlite es varias veces más lento que Postgres en Supabase, así que el límite aquí es holgado.
 */
const LIMIT_MS = 3000;
let db: PGlite;
const SUPER = { uid: ID.super, aal: "aal2" as const };
const HR = { uid: ID.hrEa, aal: "aal2" as const };

describe.skipIf(!process.env.LOAD)("Carga: 5 000 personas · 100 000 inscripciones", () => {
  beforeAll(async () => {
    db = await freshDb();
    await seed(db);
    await db.exec(`
      set session_replication_role = replica;
      insert into auth.users (id, email)
        select ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'u' || g || '@carga.test' from generate_series(1, 5000) g;
      insert into public.profiles (id, first_name, last_name_paternal, auth_email, email, employee_number, company_id, branch_id, department_id, manager_id)
        select ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'Persona', 'Carga ' || g, 'u' || g || '@carga.test', 'u' || g || '@carga.test', 'C' || g,
          case when g % 3 = 0 then '${ID.tmc}'::uuid else '${ID.ea}'::uuid end,
          case when g % 3 = 0 then '${ID.tmcQro}'::uuid when g % 2 = 0 then '${ID.eaQro}'::uuid else '${ID.eaMty}'::uuid end,
          case when g % 3 = 0 then '${ID.tmcOps}'::uuid when g % 5 = 0 then '${ID.eaVta}'::uuid else '${ID.eaOps}'::uuid end,
          null
        from generate_series(1, 5000) g;
      insert into public.courses (id, code, title, status)
        select ('00000000-0000-4000-7000-' || lpad(to_hex(c), 12, '0'))::uuid, 'CARGA-' || c, 'Curso de carga ' || c, 'published' from generate_series(1, 20) c;
      insert into public.enrollments (user_id, course_id, progress_status, result, final_score, due_at, total_seconds, assigned_at)
        select ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, ('00000000-0000-4000-7000-' || lpad(to_hex(c), 12, '0'))::uuid,
          (case when (g + c) % 4 = 0 then 'completed' when (g + c) % 4 = 1 then 'in_progress' else 'not_started' end)::public.progress_status,
          (case when (g + c) % 4 = 0 then 'passed' when (g + c) % 17 = 1 then 'failed' else 'none' end)::public.enrollment_result,
          case when (g + c) % 4 = 0 then 70 + (g % 30) end,
          now() + ((g % 40) - 10) * interval '1 day', (g % 50) * 60, now() - (c * interval '7 days')
        from generate_series(1, 5000) g, generate_series(1, 20) c;
      set session_replication_role = origin;
      analyze;
    `);
  }, 600_000);

  const time = async (label: string, fn: () => Promise<unknown>) => {
    const t = performance.now();
    await fn();
    const ms = Math.round(performance.now() - t);
    console.log(`${label}: ${ms} ms`);
    return ms;
  };

  it("cada consulta del tablero responde dentro del límite", async () => {
    const results = [
      await time("resumen (grupo)", () => q(db, SUPER, "select public.dashboard_summary('{}')")),
      await time("resumen (RH EA)", () => q(db, HR, "select public.dashboard_summary('{}')")),
      await time("personas, página 1", () => q(db, SUPER, "select public.dashboard_people('{}', 'compliance', 50, 0)")),
      await time("personas en rojo", () => q(db, SUPER, `select public.dashboard_people('{"light":"red"}', 'compliance', 50, 0)`)),
      await time("ranking departamentos", () => q(db, SUPER, "select public.dashboard_breakdown('department', '{}')")),
      await time("ranking cursos", () => q(db, SUPER, "select public.dashboard_breakdown('course', '{}')")),
      await time("actividad", () => q(db, SUPER, "select public.dashboard_activity('{}', 10)")),
      await time("foto diaria", () => db.query("select app.compliance_snapshot_job()")),
      await time("evolución", () => q(db, SUPER, "select public.dashboard_trend('{}')")),
    ];
    const n = (await db.query<{ n: number }>("select count(*)::int as n from public.enrollments")).rows[0].n;
    console.log(`inscripciones: ${n}`);
    expect(n).toBeGreaterThanOrEqual(100_000);
    expect(Math.max(...results)).toBeLessThan(LIMIT_MS);
  }, 120_000);
});
