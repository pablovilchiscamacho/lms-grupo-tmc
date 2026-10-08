import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CertificateRow = {
  id: string; number: string; verification_code: string; enrollment_id: string; user_id: string; course_id: string;
  holder_name: string; course_title: string; course_code: string; company_name: string; score: number | null;
  issued_at: string; expires_at: string | null; status: "valid" | "revoked"; revoked_at: string | null; revoked_reason: string | null;
};
const COLS = "id, number, verification_code, enrollment_id, user_id, course_id, holder_name, course_title, course_code, company_name, score, issued_at, expires_at, status, revoked_at, revoked_reason";
export const CERT_PAGE = 50;

/** Estado mostrado: vigente, vencida (por vigencia) o revocada. */
export const certState = (c: Pick<CertificateRow, "status" | "expires_at">) =>
  c.status === "revoked" ? "revoked" : c.expires_at && new Date(c.expires_at) < new Date() ? "expired" : "valid";

export async function myCertificates(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("certificates").select(COLS).eq("user_id", userId).order("issued_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CertificateRow[];
}

/** Constancias de una persona por inscripción (para enlazar desde sus cursos). */
export async function certificatesByEnrollment(userId: string) {
  return new Map((await myCertificates(userId)).map((c) => [c.enrollment_id, c]));
}

export async function listCertificates(f: { q?: string; status?: string; course?: string; user?: string; page?: number }) {
  const supabase = await createClient();
  const page = Math.max(1, f.page ?? 1);
  let q = supabase.from("certificates").select(COLS, { count: "exact" }).order("issued_at", { ascending: false })
    .range((page - 1) * CERT_PAGE, page * CERT_PAGE - 1);
  const term = f.q?.trim().replace(/[%_,()]/g, " ").slice(0, 80);
  if (term) q = q.or(`holder_name.ilike.%${term}%,number.ilike.%${term}%,course_title.ilike.%${term}%`);
  if (f.status === "revocadas") q = q.eq("status", "revoked");
  if (f.status === "vigentes") q = q.eq("status", "valid").or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (f.status === "vencidas") q = q.eq("status", "valid").lt("expires_at", new Date().toISOString());
  if (f.course && /^[0-9a-f-]{36}$/i.test(f.course)) q = q.eq("course_id", f.course);
  if (f.user && /^[0-9a-f-]{36}$/i.test(f.user)) q = q.eq("user_id", f.user);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as CertificateRow[], total: count ?? 0, page };
}

export async function certificateSettings() {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "certificates").is("company_id", null).maybeSingle();
  return (data?.value ?? {}) as { prefix?: string; signer_name?: string; signer_title?: string };
}
