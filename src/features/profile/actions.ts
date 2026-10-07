"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, type ActionResult } from "@/lib/action";

const schema = z.object({
  phone: z.string().trim().max(20).regex(/^[0-9 +()-]{7,20}$|^$/, "Usa solo números, espacios, +, ( ) o -"),
});

export async function updateMyPhone(_: unknown, fd: FormData): Promise<ActionResult> {
  return safe(async () => {
    const { phone } = schema.parse({ phone: fd.get("phone") ?? "" });
    const supabase = await createClient();
    must(await supabase.rpc("update_my_phone", { p_phone: phone }));
    revalidatePath("/perfil");
    return { ok: true, message: "Teléfono actualizado." };
  });
}
