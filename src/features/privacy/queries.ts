import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PendingNotice = { id: string; version: number; title: string; body: string; company: string; published_at: string };
export type NoticeRow = { id: string; company_id: string | null; company: string | null; version: number | null; status: "draft" | "published"; title: string; body: string; published_at: string | null; updated_at: string };
export type PrivacyOverview = { can_edit: boolean; notices: NoticeRow[]; total: number; accepted: number; pending: { id: string; name: string; employee_number: string | null }[] };

export async function myPendingNotice() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_pending_privacy_notice");
  if (error) throw error;
  return (data ?? null) as PendingNotice | null;
}

export async function privacyOverview() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("privacy_overview");
  if (error) throw error;
  return data as PrivacyOverview;
}
