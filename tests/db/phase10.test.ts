import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

/**
 * Invariantes de seguridad (Fase 10). No prueban una función en particular: revisan TODA la base,
 * así que fallan si una migración futura agrega una tabla sin RLS o una función abierta.
 */
let db: PGlite;
const rows = async <R,>(sql: string) => (await db.query<R>(sql)).rows;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
});

describe("Invariantes de seguridad de toda la base", () => {
  it("todas las tablas de public tienen RLS", async () => {
    expect(await rows("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity")).toEqual([]);
  });

  it("sin sesión (anon) no hay acceso a ninguna tabla ni vista de public", async () => {
    expect(await rows("select table_name, privilege_type from information_schema.role_table_grants where grantee in ('anon', 'PUBLIC') and table_schema = 'public'")).toEqual([]);
  });

  it("sin sesión solo se puede llamar verify_certificate", async () => {
    const r = await rows<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    expect(r.map((x) => x.proname)).toEqual(["verify_certificate"]);
  });

  it("las funciones internas del servidor no las puede llamar un usuario", async () => {
    for (const f of ["hit_rate_limit(text, integer, integer)", "resolve_login(text)", "attach_certificate_pdf(uuid, uuid, text)", "publish_course_version_v2(uuid, text, boolean)"]) {
      const [{ ok }] = await rows<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as ok`);
      expect(ok, f).toBe(false);
    }
  });

  it("toda función SECURITY DEFINER fija su search_path (evita secuestro de funciones)", async () => {
    expect(await rows(`select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'app', 'audit')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).toEqual([]);
  });

  it("las funciones nuevas nacen cerradas (privilegios por omisión)", async () => {
    await db.exec("create function public.tmp_nueva() returns int language sql as 'select 1'");
    const [{ ok }] = await rows<{ ok: boolean }>("select has_function_privilege('anon', 'public.tmp_nueva()', 'execute') as ok");
    expect(ok).toBe(false);
    await db.exec("drop function public.tmp_nueva()");
  });

  it("la bitácora no se puede modificar ni borrar desde la app", async () => {
    for (const role of ["authenticated", "service_role"]) {
      const [{ u, d }] = await rows<{ u: boolean; d: boolean }>(`select has_table_privilege('${role}', 'audit.audit_logs', 'update') u, has_table_privilege('${role}', 'audit.audit_logs', 'delete') d`);
      expect([u, d], role).toEqual([false, false]);
    }
  });

  it("tablas académicas: ningún usuario las modifica directo", async () => {
    for (const t of ["enrollments", "exam_attempts", "attempt_answers", "manual_grades", "certificates", "lesson_progress"]) {
      const [{ i, u, d }] = await rows<{ i: boolean; u: boolean; d: boolean }>(
        `select has_table_privilege('authenticated', 'public.${t}', 'insert') i, has_table_privilege('authenticated', 'public.${t}', 'update') u, has_table_privilege('authenticated', 'public.${t}', 'delete') d`);
      expect([i, u, d], t).toEqual([false, false, false]);
    }
  });
});

describe("Salud del sistema", () => {
  it("solo el Super Admin la consulta", async () => {
    const r = (await q<{ r: { audit: { total: number }; users: { active: number } } }>(db, { uid: ID.super, aal: "aal2" }, "select public.system_health() as r"))[0].r;
    expect(r.users.active).toBeGreaterThan(0);
    expect(await errorOf(q(db, { uid: ID.trainer, aal: "aal2" }, "select public.system_health()"))).toBe("FORBIDDEN");
    expect(await errorOf(q(db, { uid: null, role: "anon" }, "select public.system_health()"))).toMatch(/permission denied/);
  });
});
