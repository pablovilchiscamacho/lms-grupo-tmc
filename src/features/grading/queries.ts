import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PendingReview = {
  answer_id: string; attempt_id: string; attempt_number: number; submitted_at: string;
  user: { id: string; full_name: string; employee_number: string | null };
  course: string; exam: string; prompt: string; points: number; rubric: string | null; response: string | null;
};

export async function pendingReviews() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_reviews", { p_limit: 200 });
  if (error) throw error;
  return (data ?? []) as PendingReview[];
}
