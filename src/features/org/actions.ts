"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, UserError, type ActionResult } from "@/lib/action";

const id = z.string().uuid();
const optId = z.string().trim().transform((v) => (v === "" ? null : v)).nullable().refine((v) => v == null || id.safeParse(v).success, "Valor inválido");
const name = z.string().trim().min(2, "Mínimo 2 caracteres").max(120);
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, "1 a 20 caracteres: letras, números, - o _");
const optText = z.string().trim().max(120).transform((v) => (v === "" ? null : v)).nullable();

const schemas = {
  companies: z.object({
    name, short_name: z.string().trim().min(1, "Obligatorio").max(20), legal_name: optText,
    rfc: z.string().trim().toUpperCase().transform((v) => (v === "" ? null : v)).nullable()
      .refine((v) => v == null || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(v), "RFC inválido"),
    timezone: z.string().trim().min(3).max(60),
  }),
  branches: z.object({ company_id: id, name, code, city: optText, state: optText }),
  departments: z.object({ company_id: id, name, code, parent_id: optId, functional_area: optText }),
  positions: z.object({ company_id: id, name, code, department_id: optId }),
} as const;
export type OrgTable = keyof typeof schemas;

const TABLES = Object.keys(schemas) as OrgTable[];

/** Crear o editar un elemento de la organización. RLS exige org.manage; los triggers validan coherencia y auditan. */
export async function saveOrgItem(table: OrgTable, itemId: string | null, _: unknown, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    if (!TABLES.includes(table)) throw new UserError("Tabla inválida");
    const raw = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
    const values = schemas[table].parse(raw) as Record<string, unknown>;
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    if (itemId) {
      if (!id.safeParse(itemId).success) throw new UserError("Registro inválido");
      const { company_id: _ignored, ...rest } = values; // no se cambia de empresa un elemento existente
      void _ignored;
      const res = await supabase.from(table).update(rest).eq("id", itemId).select("id");
      must(res);
      if (!res.data?.length) throw new UserError("No tienes permiso para editar este registro.", "FORBIDDEN");
    } else {
      const res = await supabase.from(table).insert({ ...values, created_by: claims?.claims?.sub }).select("id");
      must(res);
    }
    revalidatePath("/admin/organizacion");
    return { ok: true, message: "Guardado." };
  });
}

export async function setOrgItemActive(table: OrgTable, itemId: string, active: boolean): Promise<ActionResult> {
  return safe(async () => {
    if (!TABLES.includes(table) || !id.safeParse(itemId).success) throw new UserError("Registro inválido");
    const supabase = await createClient();
    const res = await supabase.from(table).update({ is_active: active }).eq("id", itemId).select("id");
    must(res);
    if (!res.data?.length) throw new UserError("No tienes permiso para modificar este registro.", "FORBIDDEN");
    revalidatePath("/admin/organizacion");
    return { ok: true };
  });
}
