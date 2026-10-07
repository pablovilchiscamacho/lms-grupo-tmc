"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, type ActionResult } from "@/lib/action";

const uuid = z.string().uuid();
const token = z.string().min(20).max(200);

export type Snapshot = {
  type: "single_choice" | "multiple_choice" | "true_false" | "short_text" | "open_text" | "ordering" | "matching" | "scale";
  prompt: string; points: number; options: { id: string; text: string }[]; targets?: { id: string; text: string }[];
  scale?: { min: number; max: number; min_label?: string | null; max_label?: string | null }; max_chars?: number; multi?: boolean;
};
export type AttemptPayload = {
  attempt_id: string; attempt_number: number; exam_id: string; title: string; deadline_at: string | null; server_now: string;
  status: string; resumed: boolean; questions: { id: string; position: number; snapshot: Snapshot; response: Record<string, unknown> | null }[];
};

export async function startAttempt(examId: string, t: string): Promise<ActionResult<AttemptPayload>> {
  return safe(async () => {
    uuid.parse(examId); token.parse(t);
    const supabase = await createClient();
    return { ok: true, data: must(await supabase.rpc("start_attempt", { p_exam: examId, p_token: t })) as AttemptPayload };
  });
}

export async function saveAnswer(attemptId: string, questionId: string, response: unknown, t: string): Promise<ActionResult<{ saved_at?: string; closed?: boolean; expired?: boolean }>> {
  return safe(async () => {
    uuid.parse(attemptId); uuid.parse(questionId); token.parse(t);
    const supabase = await createClient();
    return { ok: true, data: must(await supabase.rpc("save_answer", { p_attempt: attemptId, p_question: questionId, p_response: response ?? null, p_token: t })) as { saved_at?: string } };
  });
}

export async function submitAttempt(attemptId: string, t: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(attemptId); token.parse(t);
    const supabase = await createClient();
    must(await supabase.rpc("submit_attempt", { p_attempt: attemptId, p_token: t }));
  });
}

export async function reportFocusLost(attemptId: string) {
  if (!uuid.safeParse(attemptId).success) return;
  const supabase = await createClient();
  await supabase.rpc("log_attempt_event", { p_attempt: attemptId, p_type: "focus_lost" });
}
