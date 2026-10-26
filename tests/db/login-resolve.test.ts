import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { ID, seed } from "./fixtures";

/** Entrar con el usuario aunque se teclee con espacios, @, mayúsculas o acentos (errores reales del piloto). */
let db: PGlite;
const resolve = async (s: string) => (await db.query<{ r: { auth_email: string } | null }>("select public.resolve_login($1) r", [s])).rows[0].r?.auth_email ?? null;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  await db.query("update public.profiles set username = 'ramirezortiz.joseatpva' where id = $1", [ID.empOps1]);
  await db.query("update public.profiles set username = 'eleazar.gonzalez' where id = $1", [ID.empVta]);
  // Dos usuarios que solo difieren en el punto: el modo tolerante no debe adivinar.
  await db.query("update public.profiles set username = 'ana.lopez' where id = $1", [ID.empOps2]);
  await db.query("update public.profiles set username = 'analopez' where id = $1", [ID.mgrMty]);
});

describe("Entrar con usuario tolerando errores comunes", () => {
  it("exacto, como siempre", async () => {
    expect(await resolve("ramirezortiz.joseatpva")).toBe("juan@ea.test");
  });
  it("con espacio de más, mayúsculas o acento", async () => {
    expect(await resolve("ramirez ortiz.joseatpva")).toBe("juan@ea.test");
    expect(await resolve("  RamírezOrtiz.JoseATPVA ")).toBe("juan@ea.test");
  });
  it("con @ al inicio", async () => {
    expect(await resolve("@eleazar.gonzalez")).toBe("carla@ea.test");
  });
  it("sin el punto", async () => {
    expect(await resolve("eleazargonzalez")).toBe("carla@ea.test");
  });
  it("no adivina si dos personas se parecen", async () => {
    expect(await resolve("ana-lopez")).toBeNull();
    expect(await resolve("ana.lopez")).not.toBeNull();   // exacto sí entra
  });
  it("un error de letras no entra (no se adivina)", async () => {
    expect(await resolve("eleazar.gonzlez")).toBeNull();
  });
  it("los correos y números de empleado siguen igual", async () => {
    expect(await resolve("Juan@EA.test")).toBe("juan@ea.test");
    expect(await resolve("20")).toBe("carla@ea.test");
  });
});
