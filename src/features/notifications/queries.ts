import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EmailStatus } from "./catalog";

export async function emailStatus() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_status");
  if (error) throw error;
  return data as EmailStatus;
}

export type OutboxRow = { id: string; to_email: string; template_key: string; subject: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null };

export async function recentEmails(limit = 30) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("email_outbox")
    .select("id, to_email, template_key, subject, status, attempts, last_error, created_at, sent_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as OutboxRow[];
}
