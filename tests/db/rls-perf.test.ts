import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

/**
 * Las políticas comparan contra conjuntos calculados una vez por consulta (migración 0025). Aquí se comprueba que
 * cada usuario ve EXACTAMENTE lo mismo que dicta app.can() renglón por renglón, y que la lista de personas no se
 * vuelve lenta con muchas personas.
 */
let db: PGlite;
const USERS = [
  ["super", ID.super, "aal2"], ["capacitación", ID.trainer, "aal2"], ["RH EA", ID.hrEa, "aal2"], ["jefe", ID.mgrOps, "aal1"],
  ["jefe de sucursal", ID.mgrMty, "aal1"], ["empleado", ID.empOps1, "aal1"], ["otra empresa", ID.empTmc, "aal1"],
] as const;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  // Sub-área de Operaciones con un puesto, para cubrir el alcance por departamento hacia abajo.
  await db.exec(`insert into public.departments (id, company_id, parent_id, name, code) values
    ('00000000-0000-4000-c000-0000000000f1', '${ID.ea}', '${ID.eaOps}', 'Patio', 'PAT');
    insert into public.positions (company_id, department_id, name, code) values ('${ID.ea}', '00000000-0000-4000-c000-0000000000f1', 'Patiero', 'PATI');
    insert into auth.users (id, email) select ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid, 'x'||g||'@t.test' from generate_series(1, 1000) g;
    insert into public.profiles (id, first_name, last_name_paternal, email, auth_email, company_id, branch_id, department_id)
    select ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid, 'N'||g, 'P'||g, 'x'||g||'@t.test', 'x'||g||'@t.test',
           case when g % 3 = 0 then '${ID.tmc}'::uuid else '${ID.ea}'::uuid end,
           case when g % 3 = 0 then '${ID.tmcQro}'::uuid when g % 2 = 0 then '${ID.eaMty}'::uuid else '${ID.eaQro}'::uuid end,
           case when g % 3 = 0 then '${ID.tmcOps}'::uuid when g % 5 = 0 then '00000000-0000-4000-c000-0000000000f1'::uuid else '${ID.eaOps}'::uuid end
    from generate_series(1, 1000) g;`);
});

const ids = async (who: string, aal: "aal1" | "aal2", sql: string) =>
  (await q<{ id: string }>(db, { uid: who, aal }, sql)).map((r) => r.id).sort();
describe("RLS por conjuntos: mismo resultado que app.can(), más rápido", () => {
  for (const [name, uid, aal] of USERS) {
    it(`${name} ve exactamente lo mismo`, async () => {
      const cases: [string, string][] = [
        ["select id from public.profiles", `select p.id from public.profiles p where p.id = '${uid}' or (app.is_active_user() and (app.can('users.read', p.company_id, p.branch_id, p.department_id, p.id) or app.can('progress.read', p.company_id, p.branch_id, p.department_id, p.id)))`],
        ["select id from public.companies", `select c.id from public.companies c where app.is_active_user() and (c.id = app.my_company_id() or app.can('org.read', c.id))`],
        ["select id from public.branches", `select b.id from public.branches b where app.is_active_user() and (b.company_id = app.my_company_id() or app.can('org.read', b.company_id, b.id))`],
        ["select id from public.departments", `select d.id from public.departments d where app.is_active_user() and (d.company_id = app.my_company_id() or app.can('org.read', d.company_id, null, d.id))`],
        ["select id from public.positions", `select p.id from public.positions p where app.is_active_user() and (p.company_id = app.my_company_id() or app.can('org.read', p.company_id, null, p.department_id))`],
      ];
      for (const [rls, rule] of cases) {
        // La regla se evalúa con funciones security definer como el mismo usuario; las tablas se leen como dueño.
        const want = (await db.transaction(async (tx) => {
          await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated", aal })]);
          return (await tx.query<{ id: string }>(rule)).rows.map((r) => r.id).sort();
        }));
        expect(await ids(uid, aal, rls), `${name}: ${rls}`).toEqual(want);
      }
    });
  }

  it("la lista de personas (con empresa, sucursal, departamento y puesto) responde rápido con 1 000 personas", async () => {
    const sql = `select p.id, c.short_name, b.name, d.name, po.name from public.profiles p
      left join public.companies c on c.id = p.company_id left join public.branches b on b.id = p.branch_id
      left join public.departments d on d.id = p.department_id left join public.positions po on po.id = p.position_id
      where p.status <> 'deleted' order by p.last_name_paternal limit 25`;
    await q(db, { uid: ID.super, aal: "aal2" }, sql);
    const t = performance.now();
    for (let i = 0; i < 5; i++) await q(db, { uid: ID.super, aal: "aal2" }, sql);
    expect((performance.now() - t) / 5).toBeLessThan(40);   // antes: ~85 ms en PGlite
  });
});
