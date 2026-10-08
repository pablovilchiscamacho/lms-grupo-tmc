import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";
import { decrypt, dump, encrypt, listTables, plan, restore } from "../../scripts/lib/backup-core.mjs";

/** Respaldo → cifrado → restauración en una base vacía (solo migraciones) → todo coincide y la bitácora sigue íntegra. */
let src: PGlite;
const T = { uid: ID.trainer, aal: "aal2" as const };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];
const runner = (db: PGlite) => async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
let lines: string[];

beforeAll(async () => {
  src = await freshDb();
  await seed(src);
  const course = (await one(q<{ id: string }>(src, T, "select public.create_course($1) as id", [{ code: "BK-1", title: "Curso respaldado" }]))).id;
  const v = (await one(q<{ id: string }>(src, T, "select id from public.course_versions where course_id = $1", [course]))).id;
  const m = await one(q<{ id: string }>(src, T, "select id from public.course_modules where course_version_id = $1", [v]));
  const l = (await one(q<{ id: string }>(src, T, "insert into public.lessons (module_id, title, position) values ($1, 'L1', 1) returning id", [m.id]))).id;
  await q(src, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>x</p>')", [l]);
  await q(src, T, "select public.publish_course_version($1)", [course]);
  await q(src, T, "select public.create_assignment($1)", [{ course_id: course, mode: "direct", user_ids: [ID.empOps1, ID.empOps2] }]);
  await q(src, { uid: ID.empOps1, aal: "aal1" }, "select public.track_lesson($1, 'open')", [l]);
  await q(src, { uid: ID.empOps1, aal: "aal1" }, "select public.complete_lesson($1)", [l]);
  await src.query("select audit.seal()");
  lines = (await dump(runner(src))).lines;
}, 60_000);

describe("Respaldo y restauración", () => {
  it("el plan rompe los ciclos de llaves (curso ↔ versión, jefe → persona) para poder insertar", async () => {
    const { order, deferred } = plan(await listTables(runner(src))) as { order: { name: string }[]; deferred: Record<string, string[]> };
    const pos = (n: string) => order.findIndex((t: { name: string }) => t.name === n);
    expect(pos("auth.users")).toBeLessThan(pos("public.profiles"));
    expect(deferred["public.profiles"]).toContain("manager_id");
    expect(Object.values(deferred).flat()).toContain("current_version_id");
  });

  it("el archivo va cifrado: sin la frase correcta no se puede leer", () => {
    const enc = encrypt(lines, "frase-de-prueba-muy-larga-123");
    expect(enc.toString("latin1")).not.toContain("Juan");
    expect(decrypt(enc, "frase-de-prueba-muy-larga-123")).toEqual(lines);
    expect(() => decrypt(enc, "otra-frase-equivocada-456789")).toThrow();
    expect(() => encrypt(lines, "corta")).toThrow();
  });

  it("restaura todo en una base nueva: mismas filas, accesos, constancias, folios y bitácora íntegra", async () => {
    const dst = await freshDb();
    const r = await restore(runner(dst), decrypt(encrypt(lines, "frase-de-prueba-muy-larga-123"), "frase-de-prueba-muy-larga-123"));
    expect(r.mismatched).toEqual([]);
    expect(r.counts["public.profiles"]).toBe(9);
    expect(r.counts["auth.users"]).toBe(9);
    expect(r.counts["public.certificates"]).toBe(1);
    expect((await dst.query<{ b: number | null }>("select audit.verify_chain() as b")).rows[0].b).toBeNull();
    // La persona conserva su jefe y su rol; la constancia se verifica igual.
    expect((await dst.query<{ m: string }>("select manager_id as m from public.profiles where id = $1", [ID.empOps2])).rows[0].m).toBe(ID.empOps1);
    const [cert] = (await dst.query<{ verification_code: string; number: string }>("select verification_code, number from public.certificates")).rows;
    const v = await one(q<{ r: { status: string } }>(dst, { uid: null, role: "anon" }, "select public.verify_certificate($1) as r", [cert.verification_code]));
    expect(v.r.status).toBe("valid");
    // La plataforma sigue funcionando: el siguiente folio continúa la numeración y los triggers volvieron a encenderse.
    await q(dst, { uid: ID.empOps2, aal: "aal1" }, "select public.track_lesson(l.id, 'open') from public.lessons l");
    await q(dst, { uid: ID.empOps2, aal: "aal1" }, "select public.complete_lesson(l.id) from public.lessons l");
    const nums = (await dst.query<{ number: string }>("select number from public.certificates order by number")).rows.map((x) => x.number);
    expect(nums[1]).toMatch(/-000002$/);
    const logged = (await dst.query<{ n: number }>("select count(*)::int as n from audit.audit_logs where action = 'certificate.created'")).rows[0].n;
    expect(logged).toBe(2);
  }, 60_000);
});
