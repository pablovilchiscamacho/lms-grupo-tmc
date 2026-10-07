/**
 * Datos demo (§67) para el proyecto de DESARROLLO. Nunca correr en producción.
 *   npm run seed:demo            → con MFA obligatorio para administradores (como en producción)
 *   npm run seed:demo -- --sin-mfa → desactiva el MFA de los roles administrativos (solo desarrollo)
 * La contraseña de todos los usuarios demo se toma de SEED_PASSWORD (o se genera y se imprime).
 */
import { randomBytes } from "node:crypto";
import { adminClient, maybe, must } from "./_admin-client";

if (process.env.APP_ENV === "production") {
  console.error("✗ seed-demo no se ejecuta con APP_ENV=production");
  process.exit(1);
}
const sb = adminClient();
const PASSWORD = process.env.SEED_PASSWORD ?? `Demo-${randomBytes(4).toString("hex")}`;
const sinMfa = process.argv.includes("--sin-mfa");

const COMPANIES = [
  { name: "Grupo TMC", short_name: "TMC" },
  { name: "EA Logística", short_name: "EA" },
  { name: "TMCa", short_name: "TMCa" },
];
const BRANCHES = [["Querétaro", "QRO", "Querétaro"], ["Monterrey", "MTY", "Nuevo León"], ["Manzanillo", "ZLO", "Colima"]];
const DEPARTMENTS = [["Operaciones", "OPS", "operaciones"], ["Ventas", "VTA", "comercial"], ["Pricing", "PRC", "pricing"],
  ["Administración", "ADM", "administracion"], ["Finanzas", "FIN", "finanzas"], ["Recursos Humanos", "RH", "rh"]];
const POSITIONS = [["Operador", "OPER", "OPS"], ["Coordinador de tráfico", "COORD", "OPS"], ["Ejecutivo comercial", "EJEC", "VTA"],
  ["Analista de pricing", "ANPR", "PRC"], ["Gerente", "GTE", null]];

async function upsertOrg() {
  const ids: Record<string, Record<string, string>> = {};
  for (const c of COMPANIES) {
    const existing = maybe(await sb.from("companies").select("id").eq("short_name", c.short_name).maybeSingle(), "empresa");
    const company = existing ?? must(await sb.from("companies").insert(c).select("id").single(), `empresa ${c.short_name}`);
    const m: Record<string, string> = { company: company.id };
    for (const [name, code, state] of BRANCHES) {
      const r = must(await sb.from("branches").upsert({ company_id: company.id, name, code, state }, { onConflict: "company_id,code" }).select("id").single(), "sucursal");
      m[`b:${code}`] = r.id;
    }
    for (const [name, code, area] of DEPARTMENTS) {
      const r = must(await sb.from("departments").upsert({ company_id: company.id, name, code, functional_area: area }, { onConflict: "company_id,code" }).select("id").single(), "depto");
      m[`d:${code}`] = r.id;
    }
    for (const [name, code, dept] of POSITIONS) {
      const r = must(await sb.from("positions").upsert({ company_id: company.id, name, code, department_id: dept ? m[`d:${dept}`] : null }, { onConflict: "company_id,code" }).select("id").single(), "puesto");
      m[`p:${code}`] = r.id;
    }
    ids[c.short_name] = m;
  }
  return ids;
}

type Demo = { key: string; first: string; last: string; last2?: string; email: string | null; emp: string; username?: string;
  co: string; branch: string; dept: string; pos: string; manager?: string; role?: [string, string] };

const USERS: Demo[] = [
  { key: "super", first: "Sofía", last: "Ramírez", last2: "Luna", email: "superadmin@demo.grupotmc.test", emp: "1000", co: "TMC", branch: "QRO", dept: "ADM", pos: "GTE", role: ["super_admin", "group"] },
  { key: "trainer", first: "Tomás", last: "Aguilar", email: "capacitacion@demo.grupotmc.test", emp: "1001", co: "TMC", branch: "QRO", dept: "RH", pos: "GTE", role: ["training_admin", "group"] },
  { key: "mgrOps", first: "Mario", last: "González", email: "mario.gonzalez@demo.ealogistica.test", emp: "2001", co: "EA", branch: "QRO", dept: "OPS", pos: "GTE", role: ["manager", "team"] },
  { key: "mgrVta", first: "Laura", last: "Hernández", email: "laura.hernandez@demo.ealogistica.test", emp: "2002", co: "EA", branch: "MTY", dept: "VTA", pos: "GTE", role: ["manager", "team"] },
  { key: "e1", first: "Juan", last: "Pérez", last2: "García", email: "juan.perez@demo.ealogistica.test", emp: "2101", co: "EA", branch: "QRO", dept: "OPS", pos: "COORD", manager: "mgrOps" },
  { key: "e2", first: "Ana", last: "López", email: null, emp: "2102", username: "ana.lopez", co: "EA", branch: "ZLO", dept: "OPS", pos: "OPER", manager: "e1" },
  { key: "e3", first: "Carlos", last: "Martínez", email: "carlos.martinez@demo.ealogistica.test", emp: "2201", co: "EA", branch: "MTY", dept: "VTA", pos: "EJEC", manager: "mgrVta" },
  { key: "e4", first: "María", last: "Sánchez", email: "maria.sanchez@demo.ealogistica.test", emp: "2301", co: "EA", branch: "QRO", dept: "PRC", pos: "ANPR", manager: "mgrVta" },
  { key: "e5", first: "Pedro", last: "Torres", email: "pedro.torres@demo.tmca.test", emp: "3101", co: "TMCa", branch: "QRO", dept: "OPS", pos: "OPER" },
];

async function main() {
  console.log("→ Organización…");
  const org = await upsertOrg();
  const created: Record<string, string> = {};
  console.log("→ Usuarios…");
  for (const u of USERS) {
    const m = org[u.co];
    const authEmail = u.email ?? `demo-${u.emp}@users.lms.internal`;
    const found = maybe(await sb.from("profiles").select("id").eq("auth_email", authEmail).maybeSingle(), "perfil");
    if (found) { created[u.key] = found.id; continue; }
    const { data, error } = await sb.auth.admin.createUser({ email: authEmail, password: PASSWORD, email_confirm: true });
    if (error || !data.user) { console.error(`✗ Auth ${authEmail}:`, error); process.exit(1); }
    created[u.key] = data.user.id;
    maybe(await sb.from("profiles").insert({
      id: data.user.id, first_name: u.first, last_name_paternal: u.last, last_name_maternal: u.last2 ?? null,
      email: u.email, auth_email: authEmail, has_real_email: !!u.email, employee_number: u.emp, username: u.username ?? null,
      company_id: m.company, branch_id: m[`b:${u.branch}`], department_id: m[`d:${u.dept}`], position_id: m[`p:${u.pos}`],
      manager_id: u.manager ? created[u.manager] : null, hire_date: "2024-01-15",
    }), `perfil ${u.key}`);
    if (u.role) {
      const role = must(await sb.from("roles").select("id").eq("key", u.role[0]).single(), "rol");
      maybe(await sb.from("user_roles").insert({ user_id: data.user.id, role_id: role.id, scope_type: u.role[1] }), `rol ${u.key}`);
    }
  }
  if (sinMfa) {
    maybe(await sb.from("roles").update({ requires_mfa: false }).in("key", ["super_admin", "training_admin", "hr_admin"]), "mfa");
    console.log("⚠ MFA desactivado para roles administrativos (solo desarrollo).");
  }
  console.log("\n✓ Datos demo listos. Contraseña de todos los usuarios demo:", PASSWORD);
  console.table(USERS.map((u) => ({ usuario: u.email ?? `${u.username} / núm. ${u.emp}`, rol: u.role?.[0] ?? "empleado", empresa: u.co })));
}
main();
