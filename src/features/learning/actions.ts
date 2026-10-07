"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { must, safe, type ActionResult } from "@/lib/action";

const uuid = z.string().uuid();
const dataSchema = z.object({
  page: z.number().int().min(1).max(5000).optional(),
  pages: z.array(z.number().int().min(1).max(5000)).max(200).optional(),
  video_pct: z.number().min(0).max(100).optional(),
  resume: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

export type TrackResult = { status: string; seconds: number; video_pct: number; pages: number; pages_list: number[] };

/** Apertura y "latidos" de una lección. El servidor decide cuánto tiempo y avance cuenta. */
export async function trackLesson(lessonId: string, event: "open" | "heartbeat", data: z.infer<typeof dataSchema> = {}): Promise<ActionResult<TrackResult>> {
  return safe(async () => {
    uuid.parse(lessonId);
    const supabase = await createClient();
    const r = must(await supabase.rpc("track_lesson", { p_lesson: lessonId, p_event: event, p_data: dataSchema.parse(data) })) as TrackResult;
    return { ok: true, data: r };
  });
}

export async function completeLesson(lessonId: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(lessonId);
    const supabase = await createClient();
    must(await supabase.rpc("complete_lesson", { p_lesson: lessonId }));
  });
}
