import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
type Who = { uid: string; aal: "aal1" | "aal2" };
const T: Who = { uid: ID.trainer, aal: "aal2" };
const SUPER: Who = { uid: ID.super, aal: "aal2" };
const HR: Who = { uid: ID.hrEa, aal: "aal2" };
const JUAN: Who = { uid: ID.empOps1, aal: "aal1" };
const ANA: Who = { uid: ID.empOps2, aal: "aal1" };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
const rows = async <R,>(sql: string, params: unknown[] = []) => (await db.query<R>(sql, params)).rows;

type Cert = { id: string; number: string; verification_code: string; holder_name: string; course_title: string; score: string | null; expires_at: string | null; status: string };
let course: string, noCert: string, lessonA: string, lessonB: string;

async function makeCourse(code: string, opts: { issues?: boolean; validity?: number } = {}) {
  const id = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id",
    [{ code, title: `Curso ${code}`, issues_certificate: opts.issues ?? true, validity_months: opts.validity ?? null }]))).id;
  const v = (await one(q<{ id: string }>(db, T, "select id from public.course_versions where course_id = $1", [id]))).id;
  const m = await one(q<{ id: string }>(db, T, "select id from public.course_modules where course_version_id = $1", [v]));
  const l = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position) values ($1, 'L1', 1) returning id", [m.id]))).id;
  await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
  await q(db, T, "select public.publish_course_version($1)", [id]);
  return { id, lesson: l };
}

/** Termina el curso como lo haría el alumno: inicia, completa la lección y recalcula. */
async function finish(who: Who, courseId: string, lesson: string) {
  await q(db, who, "select public.track_lesson($1, 'open')", [lesson]);
  await q(db, who, "select public.complete_lesson($1)", [lesson]);
  return courseId;
}

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  const a = await makeCourse("CERT-1", { validity: 12 });
  const b = await makeCourse("CERT-2", { issues: false });
  course = a.id; lessonA = a.lesson; noCert = b.id; lessonB = b.lesson;
  for (const c of [course, noCert]) {
    await q(db, T, "select public.create_assignment($1)", [{ course_id: c, mode: "direct", user_ids: [ID.empOps1, ID.empOps2, ID.empTmc] }]);
  }
});

describe("Emisión", () => {
  it("al terminar el curso se emite sola, con folio consecutivo, código de 16 caracteres y vigencia", async () => {
    await finish(JUAN, course, lessonA);
    const [c] = await rows<Cert>("select * from public.certificates where user_id = $1", [ID.empOps1]);
    expect(c.number).toMatch(/^TMC-\d{4}-000001$/);
    expect(c.verification_code).toMatch(/^[A-Z2-9]{16}$/);
    expect(c.holder_name).toBe("Juan Pérez");
    expect(c.course_title).toBe("Curso CERT-1");
    expect(c.expires_at).not.toBeNull();
    const n = await rows<{ type: string }>("select type from public.notifications where user_id = $1 and type = 'certificate_ready'", [ID.empOps1]);
    expect(n).toHaveLength(1);
    await finish(ANA, course, lessonA);
    const [c2] = await rows<Cert>("select * from public.certificates where user_id = $1", [ID.empOps2]);
    expect(c2.number).toMatch(/-000002$/);
    expect(c2.verification_code).not.toBe(c.verification_code);
  });

  it("no se emite si el curso no da constancia, y no se duplica", async () => {
    await finish(JUAN, noCert, lessonB);
    expect(await rows("select 1 from public.certificates where course_id = $1", [noCert])).toHaveLength(0);
    const e = await one(rows<{ id: string }>("select id from public.enrollments where user_id = $1 and course_id = $2", [ID.empOps1, course]));
    await db.query("select app.issue_certificate($1)", [e.id]);
    expect(await rows("select 1 from public.certificates where user_id = $1", [ID.empOps1])).toHaveLength(1);
  });

  it("nadie puede crear, cambiar ni borrar constancias desde la API", async () => {
    expect(await errorOf(q(db, SUPER, "update public.certificates set score = 100"))).toMatch(/permission denied/);
    expect(await errorOf(q(db, JUAN, "insert into public.certificates (number) values ('X')"))).toMatch(/permission denied/);
    expect(await errorOf(q(db, SUPER, "delete from public.certificates"))).toMatch(/permission denied/);
    expect(await errorOf(q(db, JUAN, "select public.attach_certificate_pdf(gen_random_uuid(), gen_random_uuid(), 'x')"))).toMatch(/permission denied/);
  });
});

describe("Lectura", () => {
  it("cada quien ve las suyas; RH ve las de su empresa; un empleado no ve las de otros", async () => {
    expect((await q<Cert>(db, JUAN, "select * from public.certificates")).map((c) => c.holder_name)).toEqual(["Juan Pérez"]);
    expect(await q(db, HR, "select * from public.certificates")).toHaveLength(2);
  });
});

describe("Verificación pública y revocación", () => {
  it("cualquiera (sin sesión) verifica con el código, aunque lo escriba con guiones o minúsculas, y solo ve datos mínimos", async () => {
    const [c] = await rows<Cert>("select * from public.certificates where user_id = $1", [ID.empOps1]);
    const pretty = c.verification_code.toLowerCase().match(/.{4}/g)!.join("-");
    const r = (await one(q<{ r: Record<string, unknown> }>(db, { uid: null, role: "anon" }, "select public.verify_certificate($1) as r", [pretty]))).r;
    expect(r).toMatchObject({ status: "valid", holder_name: "Juan Pérez", number: c.number });
    expect(Object.keys(r)).not.toContain("user_id");
    expect(JSON.stringify(r)).not.toMatch(/juan@ea\.test|"11"/);
    expect((await one(q<{ r: unknown }>(db, JUAN, "select public.verify_certificate('AAAAAAAAAAAAAAAA') as r"))).r).toBeNull();
  });

  it("solo quien tiene permiso revoca, con motivo; la verificación lo muestra revocada", async () => {
    const [c] = await rows<Cert>("select * from public.certificates where user_id = $1", [ID.empOps2]);
    expect(await errorOf(q(db, HR, "select public.revoke_certificate($1, 'x')", [c.id]))).toBe("FORBIDDEN");
    expect(await errorOf(q(db, SUPER, "select public.revoke_certificate($1, '  ')", [c.id]))).toBe("VALIDATION");
    await q(db, SUPER, "select public.revoke_certificate($1, 'Se detectó suplantación en el examen')", [c.id]);
    const r = (await one(q<{ r: { status: string } }>(db, JUAN, "select public.verify_certificate($1) as r", [c.verification_code]))).r;
    expect(r.status).toBe("revoked");
    const log = await rows<{ action: string }>("select action from audit.audit_logs where entity_type = 'certificate' and entity_id = $1 order by id", [c.id]);
    expect(log.map((l) => l.action)).toEqual(["certificate.created", "certificate.updated"]);
  });

  it("una constancia con vigencia vencida se verifica como expirada", async () => {
    const [c] = await rows<Cert>("select * from public.certificates where user_id = $1", [ID.empOps1]);
    await db.query("alter table public.certificates disable trigger certificates_audit");
    await db.query("update public.certificates set expires_at = now() - interval '1 day' where id = $1", [c.id]);
    await db.query("alter table public.certificates enable trigger certificates_audit");
    const r = (await one(q<{ r: { status: string } }>(db, JUAN, "select public.verify_certificate($1) as r", [c.verification_code]))).r;
    expect(r.status).toBe("expired");
  });
});

describe("Firma por empresa", () => {
  it("una empresa con firma propia la usa; las demás conservan la global", async () => {
    await db.query("update public.settings set value = value || '{\"signer_name\":\"Firma Global\"}' where key = 'certificates' and company_id is null");
    await db.query(`insert into public.settings (key, company_id, value) values ('certificates', $1, '{"signer_name":"Iliana Carmona","signer_title":"Capital Humano"}')`, [ID.tmc]);
    await q(db, T, "select public.create_assignment($1)", [{ course_id: course, mode: "direct", user_ids: [ID.empTmc, ID.empVta] }]);
    await finish({ uid: ID.empTmc, aal: "aal1" }, course, lessonA);
    await finish({ uid: ID.empVta, aal: "aal1" }, course, lessonA);
    const r = await rows<{ user_id: string; signer_name: string; signer_title: string | null }>("select user_id, signer_name, signer_title from public.certificates where user_id = any($1)", [[ID.empTmc, ID.empVta]]);
    expect(r.find((x) => x.user_id === ID.empTmc)).toMatchObject({ signer_name: "Iliana Carmona", signer_title: "Capital Humano" });
    expect(r.find((x) => x.user_id === ID.empVta)?.signer_name).toBe("Firma Global");
  });
});
