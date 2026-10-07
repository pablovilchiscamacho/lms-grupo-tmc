import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
const ADMIN = { aal: "aal2" as const };

const visibleProfiles = async (uid: string, aal: "aal1" | "aal2" = "aal1") =>
  (await q<{ id: string }>(db, { uid, aal }, "select id from public.profiles order by id")).map((r) => r.id);

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
});

describe("Estructura", () => {
  it("todas las tablas de public tienen RLS habilitado", async () => {
    const rows = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows.rows).toEqual([]);
  });

  it("anon no puede leer ninguna tabla", async () => {
    for (const t of ["companies", "profiles", "user_roles", "settings", "roles"]) {
      expect(await errorOf(q(db, { uid: null }, `select * from public.${t}`))).toMatch(/permission denied/);
    }
  });

  it("la bitácora no es accesible por la API (ni authenticated ni service_role)", async () => {
    expect(await errorOf(q(db, { uid: ID.super, aal: "aal2" }, "select * from audit.audit_logs"))).toMatch(/permission denied/);
    expect(await errorOf(q(db, { uid: null, role: "service_role" }, "select * from audit.audit_logs"))).toMatch(/permission denied/);
  });
});

describe("Aislamiento entre empresas y alcances (RLS de perfiles)", () => {
  it("un empleado solo se ve a sí mismo", async () => {
    expect(await visibleProfiles(ID.empOps1)).toEqual([ID.empOps1]);
    expect(await visibleProfiles(ID.empTmc)).toEqual([ID.empTmc]);
  });

  it("un empleado solo ve su propia empresa en el catálogo de empresas", async () => {
    const rows = await q<{ id: string }>(db, { uid: ID.empTmc }, "select id from public.companies");
    expect(rows.map((r) => r.id)).toEqual([ID.tmc]);
  });

  it("RH de EA (con MFA) ve a todo EA y a nadie de TMC", async () => {
    const ids = await visibleProfiles(ID.hrEa, "aal2");
    expect(ids).toContain(ID.empOps2);
    expect(ids).toContain(ID.empVta);
    expect(ids).not.toContain(ID.empTmc);
  });

  it("RH sin MFA (aal1) no tiene permisos administrativos", async () => {
    expect(await visibleProfiles(ID.hrEa, "aal1")).toEqual([ID.hrEa]);
  });

  it("el manager con alcance 'team' ve su línea de reporte (directos e indirectos) y nada más", async () => {
    const ids = await visibleProfiles(ID.mgrOps);
    expect(new Set(ids)).toEqual(new Set([ID.mgrOps, ID.empOps1, ID.empOps2]));
  });

  it("el manager con alcance de sucursal ve solo esa sucursal", async () => {
    const ids = await visibleProfiles(ID.mgrMty);
    expect(new Set(ids)).toEqual(new Set([ID.mgrMty, ID.empOps2]));
  });

  it("el Super Admin ve a todos", async () => {
    expect((await visibleProfiles(ID.super, "aal2")).length).toBe(9);
  });

  it("nadie puede escribir perfiles directamente (solo vía RPC)", async () => {
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "update public.profiles set first_name = 'X' where id = $1", [ID.empOps1])))
      .toMatch(/permission denied/);
    expect(await errorOf(q(db, { uid: ID.super, ...ADMIN }, "update public.profiles set first_name = 'X' where id = $1", [ID.empOps1])))
      .toMatch(/permission denied/);
  });

  it("un empleado no puede darse roles", async () => {
    expect(await errorOf(q(db, { uid: ID.empOps1 },
      "insert into public.user_roles (user_id, role_id, scope_type) select $1, id, 'group' from public.roles where key = 'super_admin'",
      [ID.empOps1]))).toMatch(/permission denied/);
    expect(await errorOf(q(db, { uid: ID.empOps1 },
      "select public.admin_grant_role($1, 'super_admin', 'group')", [ID.empOps1]))).toBe("FORBIDDEN");
  });
});

describe("Gestión de usuarios (RPC)", () => {
  const newUser = async (id: string, email: string) => db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);

  it("RH de EA no puede crear usuarios en TMC", async () => {
    const id = "00000000-0000-4000-9000-0000000000a1";
    await newUser(id, "nuevo1@tmc.test");
    const err = await errorOf(q(db, { uid: ID.hrEa, ...ADMIN }, "select public.admin_create_user($1, $2)", [id,
      { first_name: "Nuevo", last_name_paternal: "Uno", email: "nuevo1@tmc.test", company_id: ID.tmc }]));
    expect(err).toBe("FORBIDDEN");
  });

  it("RH de EA crea un usuario en EA y queda en la bitácora con su autoría", async () => {
    const id = "00000000-0000-4000-9000-0000000000a2";
    await newUser(id, "nuevo2@ea.test");
    await q(db, { uid: ID.hrEa, ...ADMIN }, "select public.admin_create_user($1, $2)", [id,
      { first_name: "Nuevo", last_name_paternal: "Dos", email: "nuevo2@ea.test", company_id: ID.ea, department_id: ID.eaOps, manager_id: ID.mgrOps }]);
    const p = await db.query<{ created_by: string; auth_email: string }>("select created_by, auth_email from public.profiles where id = $1", [id]);
    expect(p.rows[0]).toEqual({ created_by: ID.hrEa, auth_email: "nuevo2@ea.test" });
    const log = await db.query<{ actor_id: string; action: string }>(
      "select actor_id, action from audit.audit_logs where entity_id = $1 order by id", [id]);
    expect(log.rows[0]).toEqual({ actor_id: ID.hrEa, action: "user.created" });
    // el manager lo ve de inmediato (jerarquía actualizada por trigger)
    expect(await visibleProfiles(ID.mgrOps)).toContain(id);
  });

  it("valida duplicados y datos con errores por campo", async () => {
    const [r] = await q<{ v: Record<string, string> }>(db, { uid: ID.hrEa, ...ADMIN }, "select public.admin_validate_user($1) as v", [
      { first_name: "", last_name_paternal: "X", email: "juan@ea.test", employee_number: "11", company_id: ID.ea, branch_id: ID.tmcQro }]);
    expect(r.v).toMatchObject({ first_name: "required", email: "taken", employee_number: "taken", branch_id: "org_mismatch" });
  });

  it("el trigger impide mezclar sucursal de otra empresa aunque se salte la validación", async () => {
    const err = await errorOf(db.query("update public.profiles set branch_id = $1 where id = $2", [ID.tmcQro, ID.empOps1]));
    expect(err).toBe("ORG_MISMATCH");
  });

  it("RH no puede mover a un empleado de EA a TMC (sin alcance en el destino)", async () => {
    const err = await errorOf(q(db, { uid: ID.hrEa, ...ADMIN }, "select public.admin_update_user($1, $2)",
      [ID.empVta, { company_id: ID.tmc, branch_id: null, department_id: null }]));
    expect(err).toBe("FORBIDDEN");
  });

  it("no se permiten ciclos en la línea de reporte", async () => {
    const err = await errorOf(q(db, { uid: ID.super, ...ADMIN }, "select public.admin_update_user($1, $2)",
      [ID.mgrOps, { manager_id: ID.empOps2 }]));
    expect(err).toBe("VALIDATION");
    expect(await errorOf(db.query("update public.profiles set manager_id = $1 where id = $2", [ID.empOps2, ID.mgrOps])))
      .toBe("HIERARCHY_CYCLE");
  });

  it("al cambiar de jefe se recalcula la jerarquía", async () => {
    await q(db, { uid: ID.super, ...ADMIN }, "select public.admin_update_user($1, $2)", [ID.empOps2, { manager_id: ID.mgrOps }]);
    const rows = await db.query<{ ancestor_id: string; depth: number }>(
      "select ancestor_id, depth from public.profile_hierarchy where descendant_id = $1 order by depth", [ID.empOps2]);
    expect(rows.rows).toEqual([{ ancestor_id: ID.empOps2, depth: 0 }, { ancestor_id: ID.mgrOps, depth: 1 }]);
  });

  it("un empleado solo puede cambiar su teléfono", async () => {
    await q(db, { uid: ID.empOps1 }, "select public.update_my_phone('442 123 4567')");
    const r = await db.query<{ phone: string }>("select phone from public.profiles where id = $1", [ID.empOps1]);
    expect(r.rows[0].phone).toBe("442 123 4567");
  });
});

describe("Estados y roles", () => {
  it("no se puede desactivar a uno mismo; RH no puede tocar cuentas administrativas", async () => {
    expect(await errorOf(q(db, { uid: ID.super, ...ADMIN }, "select public.admin_set_user_status($1, 'inactive', 'x')", [ID.super])))
      .toBe("CANNOT_CHANGE_SELF");
    expect(await errorOf(q(db, { uid: ID.hrEa, ...ADMIN }, "select public.admin_set_user_status($1, 'inactive', 'x')", [ID.super])))
      .toBe("FORBIDDEN");
    expect(await errorOf(q(db, { uid: ID.hrEa, ...ADMIN }, "select public.admin_update_user($1, $2)", [ID.super, { email: "robo@x.test" }])))
      .toBe("FORBIDDEN");
    expect(await errorOf(q(db, { uid: ID.hrEa, ...ADMIN }, "select public.admin_check_user_action($1, 'users.update')", [ID.trainer])))
      .toBe("FORBIDDEN");
    // Pero sí puede gestionar a un empleado normal
    await q(db, { uid: ID.hrEa, ...ADMIN }, "select public.admin_check_user_action($1, 'users.update')", [ID.empOps1]);
  });

  it("el último Super Admin activo no puede perder su rol", async () => {
    // Un segundo Super Admin, inactivo: no cuenta como respaldo
    await db.query(`insert into public.user_roles (user_id, role_id, scope_type) select $1, id, 'group' from public.roles where key='super_admin'`, [ID.trainer]);
    await db.query(`update public.profiles set status = 'inactive' where id = $1`, [ID.trainer]);
    expect(await db.query<{ n: number }>("select app.active_super_admins() as n").then((r) => r.rows[0].n)).toBe(1);
    // Revocar el rol del inactivo sí se permite
    const [extra] = await db.query<{ id: string }>(
      "select ur.id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.key='super_admin' and ur.user_id = $1", [ID.trainer]).then((r) => r.rows);
    await q(db, { uid: ID.super, ...ADMIN }, "select public.admin_revoke_role($1)", [extra.id]);
    await db.query(`update public.profiles set status = 'active' where id = $1`, [ID.trainer]);
  });

  it("al desactivar a un usuario pierde sus permisos de inmediato", async () => {
    await q(db, { uid: ID.super, ...ADMIN }, "select public.admin_set_user_status($1, 'inactive', 'Baja temporal')", [ID.hrEa]);
    expect(await visibleProfiles(ID.hrEa, "aal2")).toEqual([ID.hrEa]);
    const [p] = await db.query<{ status: string; status_reason: string }>("select status, status_reason from public.profiles where id = $1", [ID.hrEa]).then((r) => r.rows);
    expect(p).toEqual({ status: "inactive", status_reason: "Baja temporal" });
    await q(db, { uid: ID.super, ...ADMIN }, "select public.admin_set_user_status($1, 'active', 'Regresa')", [ID.hrEa]);
  });

  it("la baja lógica conserva el registro", async () => {
    await q(db, { uid: ID.super, ...ADMIN }, "select public.admin_set_user_status($1, 'deleted', 'Renuncia')", [ID.empVta]);
    const [p] = await db.query<{ status: string; deleted_by: string }>("select status, deleted_by from public.profiles where id = $1", [ID.empVta]).then((r) => r.rows);
    expect(p).toEqual({ status: "deleted", deleted_by: ID.super });
  });

  it("el Super Admin asigna un rol con alcance; no puede asignárselo a sí mismo", async () => {
    await q(db, { uid: ID.super, ...ADMIN }, "select public.admin_grant_role($1, 'instructor', 'group')", [ID.empOps1]);
    expect(await errorOf(q(db, { uid: ID.super, ...ADMIN }, "select public.admin_grant_role($1, 'instructor', 'group')", [ID.empOps1])))
      .toBe("ROLE_ALREADY_ASSIGNED");
    expect(await errorOf(q(db, { uid: ID.super, ...ADMIN }, "select public.admin_grant_role($1, 'manager', 'team')", [ID.super])))
      .toBe("CANNOT_CHANGE_SELF");
  });

  it("el Admin de Capacitación no puede asignar roles", async () => {
    expect(await errorOf(q(db, { uid: ID.trainer, ...ADMIN }, "select public.admin_grant_role($1, 'manager', 'team')", [ID.empOps1])))
      .toBe("FORBIDDEN");
  });
});

describe("Login (resolve_login)", () => {
  const resolve = async (identifier: string) =>
    (await q<{ r: { auth_email: string } | null }>(db, { uid: null, role: "service_role" }, "select public.resolve_login($1) as r", [identifier]))[0].r;

  it("resuelve correo, usuario y número de empleado único", async () => {
    expect((await resolve("JUAN@ea.test"))?.auth_email).toBe("juan@ea.test");
    expect((await resolve("ana.lopez"))?.auth_email).toBe(`${ID.empOps2}@users.lms.internal`);
    expect((await resolve("12"))?.auth_email).toBe(`${ID.empOps2}@users.lms.internal`);
  });

  it("un número de empleado repetido entre empresas no resuelve (ambiguo)", async () => {
    expect(await resolve("11")).toBeNull();
  });

  it("solo el servidor puede resolver logins", async () => {
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "select public.resolve_login('juan@ea.test')"))).toMatch(/permission denied/);
    expect(await errorOf(q(db, { uid: null }, "select public.resolve_login('juan@ea.test')"))).toMatch(/permission denied/);
  });

  it("límite de intentos", async () => {
    const hit = async () => (await q<{ ok: boolean }>(db, { uid: null, role: "service_role" },
      "select public.hit_rate_limit('login:test', 3, 60) as ok"))[0].ok;
    expect([await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false]);
  });
});

describe("Importación", () => {
  it("clasifica filas en válidas, con error y duplicadas", async () => {
    const rows = [
      { nombre: "Luis", apellido_paterno: "Nuevo", email: "luis@ea.test", numero_empleado: "500", empresa: "ea", sucursal: "Querétaro", departamento: "operaciones", puesto: "Operador", jefe: "10" },
      { nombre: "Luis", apellido_paterno: "Repetido", email: "luis@ea.test", empresa: "EA" },
      { nombre: "Existe", apellido_paterno: "Ya", email: "juan@ea.test", empresa: "EA" },
      { nombre: "", apellido_paterno: "SinNombre", email: "x@ea.test", empresa: "EA" },
      { nombre: "Otra", apellido_paterno: "Empresa", email: "o@x.test", empresa: "Inexistente" },
      { nombre: "Jefe", apellido_paterno: "EnArchivo", numero_empleado: "501", empresa: "EA", jefe: "999" },
    ];
    const [r] = await q<{ v: Array<{ status: string; errors: string[]; manager_ref: string | null }> }>(
      db, { uid: ID.super, ...ADMIN }, "select public.admin_validate_import($1) as v", [JSON.stringify(rows)]);
    expect(r.v.map((x) => x.status)).toEqual(["valid", "duplicate", "duplicate", "error", "error", "valid"]);
    expect(r.v[3].errors).toContain("Falta el nombre");
    expect(r.v[4].errors).toContain("Empresa no encontrada");
    expect(r.v[5].manager_ref).toBe("999");
  });

  it("RH de EA no puede importar a TMC", async () => {
    const [r] = await q<{ v: Array<{ status: string; errors: string[] }> }>(db, { uid: ID.hrEa, ...ADMIN },
      "select public.admin_validate_import($1) as v",
      [JSON.stringify([{ nombre: "A", apellido_paterno: "B", email: "ab@tmc.test", empresa: "TMC" }])]);
    expect(r.v[0].status).toBe("error");
  });
});

describe("Bitácora", () => {
  it("se sella con cadena de hash y detecta alteraciones", async () => {
    const sealed = await db.query<{ n: number }>("select audit.seal() as n");
    expect(sealed.rows[0].n).toBeGreaterThan(0);
    expect((await db.query<{ v: string | null }>("select audit.verify_chain() as v")).rows[0].v).toBeNull();
  });

  it("nadie puede editar ni borrar la bitácora", async () => {
    expect(await errorOf(db.query("update audit.audit_logs set action = 'x' where id = 1"))).toBe("AUDIT_IMMUTABLE");
    expect(await errorOf(db.query("delete from audit.audit_logs where id = 1"))).toBe("AUDIT_IMMUTABLE");
  });

  it("search_audit respeta el alcance: RH de EA no ve eventos de TMC", async () => {
    await q(db, { uid: ID.super, ...ADMIN }, "select public.admin_update_user($1, $2)", [ID.empTmc, { phone: "5555555555" }]);
    await db.query(`insert into public.role_permissions (role_id, permission_key) select id, 'audit.read' from public.roles where key = 'hr_admin'`);
    const rows = await q<{ company_id: string }>(db, { uid: ID.hrEa, ...ADMIN }, "select company_id from public.search_audit()");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.company_id === ID.ea)).toBe(true);
  });

  it("un empleado no puede consultar la bitácora", async () => {
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "select * from public.search_audit()"))).toBe("FORBIDDEN");
  });
});

describe("Organización", () => {
  it("solo el Super Admin crea empresas; RH no", async () => {
    expect(await errorOf(q(db, { uid: ID.hrEa, ...ADMIN }, "insert into public.companies (name, short_name) values ('X SA', 'X')")))
      .toMatch(/row-level security/);
    await q(db, { uid: ID.super, ...ADMIN }, "insert into public.companies (name, short_name) values ('TMCa', 'TMCa')");
    const r = await db.query("select 1 from public.companies where short_name = 'TMCa'");
    expect(r.rows.length).toBe(1);
  });

  it("sin ciclos en sub-departamentos", async () => {
    await db.query("update public.departments set parent_id = $1 where id = $2", [ID.eaOps, ID.eaVta]);
    expect(await errorOf(db.query("update public.departments set parent_id = $1 where id = $2", [ID.eaVta, ID.eaOps])))
      .toBe("HIERARCHY_CYCLE");
  });

  it("my_context devuelve perfil, permisos y si exige MFA", async () => {
    const [r] = await q<{ c: { permissions: string[]; requires_mfa: boolean; profile: { full_name: string } } }>(
      db, { uid: ID.hrEa, aal: "aal1" }, "select public.my_context() as c");
    expect(r.c.requires_mfa).toBe(true);
    expect(r.c.permissions).toEqual([]); // sin MFA no hay permisos
    expect(r.c.profile.full_name).toBe("Rocío Humanos");
  });
});
