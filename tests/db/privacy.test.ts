import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
type Who = { uid: string; aal: "aal1" | "aal2" };
const SUPER: Who = { uid: ID.super, aal: "aal2" };
const HR: Who = { uid: ID.hrEa, aal: "aal2" };
const JUAN: Who = { uid: ID.empOps1, aal: "aal1" };
const PEDRO: Who = { uid: ID.empTmc, aal: "aal1" };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
const BODY = "{{empresa}} es responsable del tratamiento de tus datos personales en la plataforma de capacitación. Actualizado el {{fecha}}.";
const pending = async (who: Who) => (await one(q<{ r: { id: string; body: string } | null }>(db, who, "select public.my_pending_privacy_notice() as r"))).r;
const ctxPending = async (who: Who) => (await one(q<{ c: { privacy_pending: boolean } }>(db, who, "select public.my_context() as c"))).c.privacy_pending;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
});

describe("Aviso de privacidad al ingresar", () => {
  it("sin aviso publicado no se pide nada", async () => {
    expect(await ctxPending(JUAN)).toBe(false);
    expect(await pending(JUAN)).toBeNull();
  });

  it("no se puede publicar con datos pendientes entre corchetes; solo el Super Admin publica", async () => {
    const id = (await one(q<{ id: string }>(db, SUPER, "select public.save_privacy_notice_draft(null, 'Aviso de privacidad', $1) as id", [BODY + " Domicilio: [DOMICILIO]."]))).id;
    expect(await errorOf(q(db, SUPER, "select public.publish_privacy_notice($1)", [id]))).toBe("VALIDATION");
    expect(await errorOf(q(db, HR, "select public.save_privacy_notice_draft(null, 'X', $1)", [BODY]))).toBe("FORBIDDEN");
    await q(db, SUPER, "select public.save_privacy_notice_draft(null, 'Aviso de privacidad', $1)", [BODY]);
    expect((await one(q<{ v: number }>(db, SUPER, "select public.publish_privacy_notice($1) as v", [id]))).v).toBe(1);
  });

  it("publicado, a cada persona se le pide aceptarlo con el nombre de SU empresa; al aceptar ya no se le pide", async () => {
    expect(await ctxPending(JUAN)).toBe(true);
    const n = await pending(JUAN);
    expect(n!.body).toContain("EA Logística es responsable");
    expect(n!.body).not.toContain("{{fecha}}");
    await q(db, JUAN, "select public.accept_privacy_notice($1)", [n!.id]);
    expect(await ctxPending(JUAN)).toBe(false);
    const log = await db.query<{ action: string }>("select action from audit.audit_logs where action = 'privacy.accepted'");
    expect(log.rows).toHaveLength(1);
  });

  it("una empresa con aviso propio usa el suyo", async () => {
    const id = (await one(q<{ id: string }>(db, SUPER, "select public.save_privacy_notice_draft($1, 'Aviso de privacidad TMC', $2) as id", [ID.tmc, BODY + " Aviso propio."]))).id;
    await q(db, SUPER, "select public.publish_privacy_notice($1)", [id]);
    expect((await pending(PEDRO))!.body).toContain("Aviso propio");
    expect(await pending(JUAN)).toBeNull();   // EA sigue con el del grupo, ya aceptado
  });

  it("una versión nueva se debe aceptar otra vez; no se puede aceptar una versión vieja", async () => {
    const old = (await one(db.query<{ id: string }>("select id from public.privacy_notices where company_id is null and status = 'published'").then((r) => r.rows))).id;
    const draft = (await one(q<{ id: string }>(db, SUPER, "select public.save_privacy_notice_draft(null, 'Aviso de privacidad', $1) as id", [BODY + " Versión 2."]))).id;
    expect((await one(q<{ v: number }>(db, SUPER, "select public.publish_privacy_notice($1) as v", [draft]))).v).toBe(2);
    expect(await ctxPending(JUAN)).toBe(true);
    expect(await errorOf(q(db, JUAN, "select public.accept_privacy_notice($1)", [old]))).toBe("VALIDATION");
  });

  it("las aceptaciones no se cambian ni se borran; RH ve las de su empresa y el avance", async () => {
    await expect(db.query("delete from public.privacy_acceptances")).rejects.toThrow();
    await expect(db.query("update public.privacy_acceptances set accepted_at = now()")).rejects.toThrow();
    expect(await q(db, HR, "select * from public.privacy_acceptances")).toHaveLength(1);
    expect(await q(db, PEDRO, "select * from public.privacy_acceptances")).toHaveLength(0);
    const o = (await one(q<{ r: { total: number; accepted: number; pending: { name: string }[]; can_edit: boolean } }>(db, HR, "select public.privacy_overview() as r"))).r;
    expect(o.can_edit).toBe(false);
    expect(o.accepted).toBe(0);   // Juan aceptó la v1, no la v2
    expect(o.pending.map((p) => p.name)).toContain("Juan Pérez");
    expect(o.pending.some((p) => p.name === "Pedro Tmc")).toBe(false);
  });
});
