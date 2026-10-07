"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, type ActionResult } from "@/lib/action";

export async function gradeAnswer(answerId: string, pct: number, feedback: string): Promise<ActionResult> {
  return safe(async () => {
    z.string().uuid().parse(answerId);
    const p = z.number().min(0).max(100).parse(pct);
    const supabase = await createClient();
    must(await supabase.rpc("grade_answer", { p_answer: answerId, p_pct: p, p_feedback: z.string().max(4000).parse(feedback) }));
    revalidatePath("/admin/calificaciones");
    return { ok: true, message: "Calificación guardada." };
  });
}

export async function voidAttempt(attemptId: string, reason: string): Promise<ActionResult> {
  return safe(async () => {
    z.string().uuid().parse(attemptId);
    const supabase = await createClient();
    must(await supabase.rpc("void_attempt", { p_attempt: attemptId, p_reason: reason }));
    revalidatePath("/admin/calificaciones");
  });
}
