import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

/** Importar personal sin cargar antes sucursales, departamentos y puestos: se crean solos (sin duplicar). */
let db: PGlite;
const HR_TMC = "00000000-0000-4000-9000-0000000000b1";
const HR_DEPTO = "00000000-0000-4000-9000-0000000000b2";
const AS = (uid: string) => ({ uid, aal: "aal2" as const });
type Checked = { status: string; errors: string[]; new_org: { kind: string; name: string }[]; data: Record<string, string | null> };
const validate = async (uid: string, rows: object[]) =>
  (await q<{ v: Checked[] }>(db, AS(uid), "select public.admin_validate_import($1) as v", [JSON.stringify(rows)]))[0].v;
const createOrg = async (uid: string, rows: object[]) =>
  (await q<{ v: Record<string, string[]> }>(db, AS(uid), "select public.admin_import_create_org($1) as v", [JSON.stringify(rows)]))[0].v;

const ROWS = [
  { nombre: "Ana", apellido_paterno: "Uno", numero_empleado: "901", empresa: "TMC", sucursal: "San Luis", departamento: "Almacén", puesto: "Montacarguista" },
  { nombre: "Beto", apellido_paterno: "Dos", numero_empleado: "902", empresa: "TMC", sucursal: "san luis", departamento: "ALMACEN", puesto: "Jefe  de almacén" },
  { nombre: "Caro", apellido_paterno: "Tres", numero_empleado: "903", empresa: "TMC", sucursal: "Querétaro", departamento: "Operaciones", puesto: "Montacarguista" },
];

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  for (const [id, scope, scopeId] of [[HR_TMC, "company", ID.tmc], [HR_DEPTO, "department", ID.tmcOps]] as const) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@t.test`]);
    await db.query(`insert into public.profiles (id, first_name, last_name_paternal, email, auth_email, company_id)
                    values ($1, 'RH', 'Prueba', $2, $2, $3)`, [id, `${id}@t.test`, ID.tmc]);
    await db.query(`insert into public.user_roles (user_id, role_id, scope_type, scope_id)
                    select $1, id, $2::public.scope_type, $3 from public.roles where key = 'hr_admin'`, [id, scope, scopeId]);
  }
});

describe("Importación que crea la estructura", () => {
  it("la validación anuncia lo que se creará en lugar de marcar error", async () => {
    const v = await validate(HR_TMC, ROWS);
    expect(v.map((r) => r.status)).toEqual(["valid", "valid", "valid"]);
    expect(v[0].new_org).toEqual([
      { kind: "branch", name: "San Luis" }, { kind: "department", name: "Almacén" }, { kind: "position", name: "Montacarguista" }]);
    expect(v[1].new_org.find((n) => n.kind === "position")!.name).toBe("Jefe de almacén");   // espacios de más se limpian
    expect(v[2].new_org).toEqual([{ kind: "position", name: "Montacarguista" }]);           // Querétaro y Operaciones ya existen
  });

  it("crea cada cosa una sola vez, aunque venga escrita con otras mayúsculas o sin acento", async () => {
    const made = await createOrg(HR_TMC, ROWS);
    expect(made).toEqual({ branch: ["San Luis"], department: ["Almacén"], position: ["Montacarguista", "Jefe de almacén"] });
    const deps = await db.query<{ name: string; code: string }>("select name, code from public.departments where company_id = $1 order by name", [ID.tmc]);
    expect(deps.rows).toEqual([{ name: "Almacén", code: "ALM" }, { name: "Operaciones", code: "OPS" }]);
    const pos = await db.query<{ code: string; dept: string }>(`select p.code, d.name dept from public.positions p
      left join public.departments d on d.id = p.department_id where p.company_id = $1 and p.name = 'Jefe de almacén'`, [ID.tmc]);
    expect(pos.rows[0]).toEqual({ code: "JEFDEALM", dept: "Almacén" });
    expect(await createOrg(HR_TMC, ROWS)).toEqual({ branch: [], department: [], position: [] });   // repetir no duplica
    const v = await validate(HR_TMC, ROWS);
    expect(v.every((r) => r.new_org.length === 0 && r.data.department_id && r.data.position_id && r.data.branch_id)).toBe(true);
    const log = await db.query("select 1 from audit.audit_logs where action = 'org.created_by_import'");
    expect(log.rows).toHaveLength(1);
  });

  it("quien solo tiene alcance de un departamento no crea estructura: sigue viendo el error", async () => {
    const rows = [{ nombre: "Dani", apellido_paterno: "Cuatro", numero_empleado: "904", empresa: "TMC", sucursal: "Querétaro", departamento: "Operaciones", puesto: "Soldador" }];
    const v = await validate(HR_DEPTO, rows);
    expect(v[0].status).toBe("error");
    expect(v[0].errors).toContain("Puesto no encontrado");
    expect(await createOrg(HR_DEPTO, rows)).toEqual({ branch: [], department: [], position: [] });
  });

  it("no crea nada en otra empresa", async () => {
    const rows = [{ nombre: "Eva", apellido_paterno: "Cinco", numero_empleado: "905", empresa: "EA", departamento: "Taller" }];
    expect((await validate(HR_TMC, rows))[0].status).toBe("error");
    expect(await createOrg(HR_TMC, rows)).toEqual({ branch: [], department: [], position: [] });
    expect((await db.query("select 1 from public.departments where name = 'Taller'")).rows).toHaveLength(0);
  });
});
