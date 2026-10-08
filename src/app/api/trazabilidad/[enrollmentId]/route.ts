import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { renderTracePdf } from "@/features/traceability/pdf";
import type { EnrollmentTrace } from "@/features/traceability/queries";

/** Evidencia de trazabilidad en PDF (misma autorización que la pantalla; queda en la bitácora). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/trazabilidad/[enrollmentId]">) {
  const { enrollmentId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(enrollmentId)) return new NextResponse("No encontrado", { status: 404 });
  const session = await getContext();
  if (!session) return new NextResponse("Inicia sesión", { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enrollment_trace", { p_enrollment: enrollmentId });
  if (error) return new NextResponse(error.message === "FORBIDDEN" ? "No tienes acceso a esta información." : "No encontrado", { status: error.message === "FORBIDDEN" ? 403 : 404 });
  const t = data as EnrollmentTrace;
  const chain = (await supabase.rpc("verify_audit_chain")).data as { ok: boolean; sealed: number } | null;   // null si no tiene audit.read
  await supabase.rpc("log_report_export", { p_key: "enrollment_trace", p_format: "pdf", p_filters: { enrollment_id: enrollmentId }, p_rows: t.attempts.length });
  const bytes = await renderTracePdf(t, session.profile.full_name, session.profile.company.timezone, chain);
  const slug = `${t.person.full_name}-${t.course.code}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
  return new NextResponse(bytes as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="trazabilidad-${slug}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
