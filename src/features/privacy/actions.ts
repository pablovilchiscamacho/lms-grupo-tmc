"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, type ActionResult } from "@/lib/action";

export async function acceptPrivacy(noticeId: string): Promise<ActionResult> {
  const r = await safe(async () => {
    const supabase = await createClient();
    must(await supabase.rpc("accept_privacy_notice", { p_notice: z.string().uuid().parse(noticeId) }));
  });
  if (!r.ok) return r;
  redirect("/");
}

const draftSchema = z.object({
  company_id: z.string().uuid().nullable(),
  title: z.string().trim().min(3, "Escribe un título").max(200),
  body: z.string().trim().min(50, "El texto es muy corto").max(60000),
});

export async function savePrivacyDraft(input: z.input<typeof draftSchema>): Promise<ActionResult<{ id: string }>> {
  return safe(async () => {
    const v = draftSchema.parse(input);
    const supabase = await createClient();
    const id = must(await supabase.rpc("save_privacy_notice_draft", { p_company: v.company_id, p_title: v.title, p_body: v.body })) as string;
    revalidatePath("/admin/privacidad");
    return { ok: true, data: { id }, message: "Borrador guardado." };
  });
}

export async function publishPrivacy(id: string): Promise<ActionResult> {
  return safe(async () => {
    const supabase = await createClient();
    const v = must(await supabase.rpc("publish_privacy_notice", { p_id: z.string().uuid().parse(id) })) as number;
    revalidatePath("/admin/privacidad");
    return { ok: true, message: `Versión ${v} publicada: se pedirá aceptarla al ingresar.` };
  });
}
