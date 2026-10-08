"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, type ActionResult } from "@/lib/action";

export async function revokeCertificate(id: string, reason: string): Promise<ActionResult> {
  return safe(async () => {
    const v = z.object({ id: z.string().uuid(), reason: z.string().trim().min(5, "Escribe el motivo (mínimo 5 letras)").max(500) }).parse({ id, reason });
    const supabase = await createClient();
    must(await supabase.rpc("revoke_certificate", { p_id: v.id, p_reason: v.reason }));
    revalidatePath("/admin/certificados");
  });
}

const settingsSchema = z.object({
  signer_name: z.string().trim().max(120),
  signer_title: z.string().trim().max(120),
});

/** Firma de las constancias nuevas (las ya emitidas conservan la que tenían). */
export async function saveCertificateSettings(input: z.infer<typeof settingsSchema>): Promise<ActionResult> {
  return safe(async () => {
    const v = settingsSchema.parse(input);
    const supabase = await createClient();
    const { data: cur } = await supabase.from("settings").select("id, value").eq("key", "certificates").is("company_id", null).single();
    must(await supabase.from("settings").update({ value: { ...(cur?.value as object), ...v } }).eq("id", cur!.id).select("id").single());
    revalidatePath("/admin/certificados");
    return { ok: true, message: "Guardado. Se usará en las constancias que se emitan desde ahora." };
  });
}
