import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { renderTrainingRecord, type TrainingRecord } from "@/features/reports/record-pdf";

/** Expediente de capacitación de una persona en PDF (jefe, RH, Dirección o la propia persona). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/expediente/[userId]">) {
  const { userId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return new NextResponse("No encontrado", { status: 404 });
  const session = await getContext();
  if (!session) return new NextResponse("Inicia sesión", { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("training_record", { p_user: userId });
  if (error) return new NextResponse(error.message === "FORBIDDEN" ? "No tienes acceso a este expediente." : "No se pudo generar.", { status: error.message === "FORBIDDEN" ? 403 : 500 });
  const rec = data as TrainingRecord;
  // Quien descarga el expediente de otra persona queda en la bitácora (si no tiene reports.export, no se bloquea por eso).
  if (userId !== session.profile.id) {
    await supabase.rpc("log_report_export", { p_key: "training_record", p_format: "pdf", p_filters: { user_id: userId }, p_rows: rec.courses.length });
  }
  const bytes = await renderTrainingRecord(rec, session.profile.full_name, session.profile.company.timezone);
  const slug = rec.person.full_name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
  return new NextResponse(bytes as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="expediente-${slug}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
