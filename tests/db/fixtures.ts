import type { PGlite } from "@electric-sql/pglite";

/** Ids fijos para que las pruebas se lean fácil. */
export const ID = {
  ea: "00000000-0000-4000-a000-0000000000e1",
  tmc: "00000000-0000-4000-a000-0000000000e2",
  eaQro: "00000000-0000-4000-b000-000000000001",
  eaMty: "00000000-0000-4000-b000-000000000002",
  tmcQro: "00000000-0000-4000-b000-000000000003",
  eaOps: "00000000-0000-4000-c000-000000000001",
  eaVta: "00000000-0000-4000-c000-000000000002",
  tmcOps: "00000000-0000-4000-c000-000000000003",
  eaOperador: "00000000-0000-4000-d000-000000000001",
  // usuarios
  super: "00000000-0000-4000-9000-000000000001",
  trainer: "00000000-0000-4000-9000-000000000002",
  hrEa: "00000000-0000-4000-9000-000000000003",
  mgrOps: "00000000-0000-4000-9000-000000000004",
  empOps1: "00000000-0000-4000-9000-000000000005",
  empOps2: "00000000-0000-4000-9000-000000000006",
  empVta: "00000000-0000-4000-9000-000000000007",
  empTmc: "00000000-0000-4000-9000-000000000008",
  mgrMty: "00000000-0000-4000-9000-000000000009",
} as const;

type U = {
  id: string; first: string; last: string; company: string; email: string | null; emp?: string; username?: string;
  branch?: string; dept?: string; manager?: string;
};

const users: U[] = [
  { id: ID.super, first: "Sofía", last: "Admin", company: ID.ea, email: "super@grupotmc.test", emp: "1" },
  { id: ID.trainer, first: "Tomás", last: "Capacita", company: ID.ea, email: "capacitacion@grupotmc.test", emp: "2" },
  { id: ID.hrEa, first: "Rocío", last: "Humanos", company: ID.ea, email: "rh@ea.test", emp: "3" },
  { id: ID.mgrOps, first: "Mario", last: "Gerente", company: ID.ea, email: "mario@ea.test", emp: "10", branch: ID.eaQro, dept: ID.eaOps },
  { id: ID.empOps1, first: "Juan", last: "Pérez", company: ID.ea, email: "juan@ea.test", emp: "11", branch: ID.eaQro, dept: ID.eaOps, manager: ID.mgrOps },
  { id: ID.empOps2, first: "Ana", last: "López", company: ID.ea, email: null, emp: "12", username: "ana.lopez", branch: ID.eaMty, dept: ID.eaOps, manager: ID.empOps1 },
  { id: ID.empVta, first: "Carla", last: "Ventas", company: ID.ea, email: "carla@ea.test", emp: "20", branch: ID.eaQro, dept: ID.eaVta },
  { id: ID.empTmc, first: "Pedro", last: "Tmc", company: ID.tmc, email: "pedro@tmc.test", emp: "11", branch: ID.tmcQro, dept: ID.tmcOps },
  { id: ID.mgrMty, first: "Laura", last: "Sucursal", company: ID.ea, email: "laura@ea.test", emp: "30", branch: ID.eaMty },
];

export async function seed(db: PGlite) {
  await db.exec(`
    insert into public.companies (id, name, short_name) values
      ('${ID.ea}', 'EA Logística', 'EA'), ('${ID.tmc}', 'TMC', 'TMC');
    insert into public.branches (id, company_id, name, code) values
      ('${ID.eaQro}', '${ID.ea}', 'Querétaro', 'QRO'), ('${ID.eaMty}', '${ID.ea}', 'Monterrey', 'MTY'),
      ('${ID.tmcQro}', '${ID.tmc}', 'Querétaro', 'QRO');
    insert into public.departments (id, company_id, name, code) values
      ('${ID.eaOps}', '${ID.ea}', 'Operaciones', 'OPS'), ('${ID.eaVta}', '${ID.ea}', 'Ventas', 'VTA'),
      ('${ID.tmcOps}', '${ID.tmc}', 'Operaciones', 'OPS');
    insert into public.positions (id, company_id, department_id, name, code) values
      ('${ID.eaOperador}', '${ID.ea}', '${ID.eaOps}', 'Operador', 'OPER');
  `);
  for (const u of users) {
    const authEmail = u.email ?? `${u.id}@users.lms.internal`;
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [u.id, authEmail]);
    await db.query(
      `insert into public.profiles (id, first_name, last_name_paternal, email, auth_email, has_real_email, employee_number,
         username, company_id, branch_id, department_id, manager_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [u.id, u.first, u.last, u.email, authEmail, u.email !== null, u.emp ?? null, u.username ?? null, u.company,
       u.branch ?? null, u.dept ?? null, u.manager ?? null],
    );
  }
  const grant = (user: string, role: string, scope: string, scopeId: string | null) =>
    db.query(
      `insert into public.user_roles (user_id, role_id, scope_type, scope_id)
       select $1, id, $3::public.scope_type, $4 from public.roles where key = $2`,
      [user, role, scope, scopeId],
    );
  await grant(ID.super, "super_admin", "group", null);
  await grant(ID.trainer, "training_admin", "group", null);
  await grant(ID.hrEa, "hr_admin", "company", ID.ea);
  await grant(ID.mgrOps, "manager", "team", null);
  await grant(ID.mgrMty, "manager", "branch", ID.eaMty);
}
