import { z } from "zod";

const opt = z.string().trim().max(120).transform((v) => (v === "" ? null : v)).nullable().optional();
const optId = z.string().trim().transform((v) => (v === "" ? null : v)).nullable().optional()
  .refine((v) => v == null || /^[0-9a-f-]{36}$/i.test(v), "Valor inválido");

export const userSchema = z.object({
  first_name: z.string().trim().min(1, "Obligatorio").max(80),
  last_name_paternal: z.string().trim().min(1, "Obligatorio").max(80),
  last_name_maternal: opt,
  has_real_email: z.boolean(),
  email: z.string().trim().toLowerCase().max(200).transform((v) => (v === "" ? null : v)).nullable()
    .refine((v) => v == null || z.email().safeParse(v).success, "Correo inválido"),
  employee_number: z.string().trim().max(30).transform((v) => (v === "" ? null : v)).nullable()
    .refine((v) => v == null || /^[A-Za-z0-9_-]{1,30}$/.test(v), "Solo letras, números, - y _"),
  username: z.string().trim().toLowerCase().max(40).transform((v) => (v === "" ? null : v)).nullable()
    .refine((v) => v == null || /^[a-z0-9._-]{3,40}$/.test(v), "3 a 40 caracteres: letras, números, punto, guion"),
  phone: z.string().trim().max(20).transform((v) => (v === "" ? null : v)).nullable()
    .refine((v) => v == null || /^[0-9 +()-]{7,20}$/.test(v), "Teléfono inválido"),
  company_id: z.string().uuid("Elige la empresa"),
  branch_id: optId,
  department_id: optId,
  position_id: optId,
  manager_id: optId,
  hire_date: z.string().trim().transform((v) => (v === "" ? null : v)).nullable()
    .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha inválida"),
}).superRefine((v, ctx) => {
  if (v.has_real_email && !v.email) ctx.addIssue({ code: "custom", path: ["email"], message: "Obligatorio si tiene correo corporativo" });
  if (!v.has_real_email && !v.employee_number && !v.username)
    ctx.addIssue({ code: "custom", path: ["employee_number"], message: "Sin correo, necesita número de empleado o usuario para entrar" });
});
export type UserInput = z.infer<typeof userSchema>;

export function userFromForm(fd: FormData) {
  const s = (k: string) => (fd.get(k) ?? "").toString();
  return userSchema.parse({
    first_name: s("first_name"), last_name_paternal: s("last_name_paternal"), last_name_maternal: s("last_name_maternal"),
    has_real_email: fd.get("has_real_email") === "on", email: s("email"), employee_number: s("employee_number"),
    username: s("username"), phone: s("phone"), company_id: s("company_id"), branch_id: s("branch_id"),
    department_id: s("department_id"), position_id: s("position_id"), manager_id: s("manager_id"), hire_date: s("hire_date"),
  });
}
