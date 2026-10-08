import { NextResponse, type NextRequest } from "next/server";
import { getContext, can } from "@/lib/auth/session";
import { reportBySlug } from "@/features/reports/catalog";
import { describeFilters, logExport, parseReportFilters, runReportAll } from "@/features/reports/queries";
import { toCsv, toPdf, toXlsx } from "@/features/reports/export";

const TYPES = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv; charset=utf-8", pdf: "application/pdf" } as const;

/** Descarga de un reporte: ?formato=xlsx|csv|pdf más los mismos filtros de la pantalla. Respeta el alcance y queda en la bitácora. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/reports/[slug]">) {
  const { slug } = await ctx.params;
  const def = reportBySlug(slug);
  if (!def) return new NextResponse("Reporte no encontrado", { status: 404 });
  const session = await getContext();
  if (!session) return new NextResponse("Inicia sesión", { status: 401 });
  if (!can(session, "reports.export")) return new NextResponse("No tienes permiso para exportar reportes.", { status: 403 });
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const format = (sp.formato ?? "xlsx") as keyof typeof TYPES;
  if (!(format in TYPES)) return new NextResponse("Formato no válido", { status: 400 });

  const f = parseReportFilters(sp);
  const { rows, total, truncated } = await runReportAll(def.key, f);
  await logExport(def.key, format, f, rows.length);
  const tz = session.profile.company.timezone;
  const statusLabel = def.status?.find(([k]) => k === f.status)?.[1];
  const meta = { def, filters: await describeFilters({ ...f, status: statusLabel ?? f.status }), generatedBy: session.profile.full_name, tz, total, truncated };
  const body = format === "csv" ? toCsv(rows, def.columns, tz) : format === "xlsx" ? await toXlsx(rows, def.columns, meta) : await toPdf(rows, def.columns, meta);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="reporte-${def.slug}-${date}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
