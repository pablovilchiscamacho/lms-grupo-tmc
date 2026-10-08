"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, type ActionResult } from "@/lib/action";

const schema = z.object({
  email: z.object({
    enabled: z.boolean(),
    from: z.string().trim().min(5, "Escribe el remitente").max(120),
    reply_to: z.string().trim().email("Correo no válido").max(120).nullable().or(z.literal("").transform(() => null)),
    types: z.record(z.string(), z.boolean()),
  }),
  reminders: z.object({
    days_before: z.array(z.number().int().min(0).max(60)).max(6),
    overdue: z.boolean(),
    overdue_every_days: z.number().int().min(0).max(60),
    manager_digest: z.boolean(),
  }),
});

export async function saveNotificationSettings(input: z.input<typeof schema>): Promise<ActionResult> {
  return safe(async () => {
    const v = schema.parse(input);
    const supabase = await createClient();
    must(await supabase.rpc("save_notification_settings", { p_email: v.email, p_reminders: v.reminders }));
    revalidatePath("/admin/notificaciones");
    return { ok: true, message: "Configuración guardada." };
  });
}

export async function sendTestEmail(to: string): Promise<ActionResult> {
  return safe(async () => {
    const v = z.string().trim().email("Correo no válido").parse(to);
    const supabase = await createClient();
    must(await supabase.rpc("send_test_email", { p_to: v }));
    revalidatePath("/admin/notificaciones");
    return { ok: true, message: "Correo de prueba en camino: sale en menos de 2 minutos." };
  });
}
