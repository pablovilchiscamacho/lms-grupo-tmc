import { describe, expect, it } from "vitest";
import { userSchema } from "./schemas";

const base = { first_name: "Ana", last_name_paternal: "López", last_name_maternal: "", has_real_email: false, email: "", employee_number: "", phone: "",
  company_id: "00000000-0000-4000-a000-0000000000e1", branch_id: "", department_id: "", position_id: "", manager_id: "", hire_date: "" };
const parse = (username: string) => userSchema.safeParse({ ...base, username });

describe("Usuario de acceso", () => {
  it("convierte «Juan Pérez» en «juan.perez»", () => {
    const r = parse("  Juan Pérez ");
    expect(r.success && r.data.username).toBe("juan.perez");
  });
  it("si escriben (o el navegador autocompleta) un correo, lo explica", () => {
    const r = parse("maria.martinez@atpva.mx");
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("no es un correo");
  });
  it("vacío está bien si tiene número de empleado", () => {
    expect(userSchema.safeParse({ ...base, username: "", employee_number: "1023" }).success).toBe(true);
  });
  it("muy corto da un mensaje claro", () => {
    expect(JSON.stringify(parse("jp").error?.issues)).toContain("3 a 40");
  });
});
