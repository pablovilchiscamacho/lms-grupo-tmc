import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { putObject, signedReadUrl } from "@/lib/storage";
import { renderCertificate, type CertificateData } from "@/features/certificates/pdf";
import { siteUrl, verifyUrl } from "@/features/certificates/server";

const BUCKET = "certificates";

/**
 * Descarga la constancia. Autoriza con RLS (la propia, o certificates.read en alcance).
 * La primera vez genera el PDF, lo guarda con su sha256 y desde entonces entrega siempre el mismo archivo.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/certificates/[id]/pdf">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const supabase = await createClient();
  const { data: c } = await supabase.from("certificates").select("*").eq("id", id).maybeSingle();
  if (!c) return new NextResponse("No encontrado", { status: 404 });
  if (c.status === "revoked") return new NextResponse("Esta constancia fue revocada y ya no se puede descargar.", { status: 410 });
  const name = `Constancia ${c.number}.pdf`;
  const admin = createAdminClient();

  let fileId: string | null = c.pdf_file_id;
  if (!fileId) {
    const base = await siteUrl();
    const bytes = await renderCertificate(c as unknown as CertificateData, verifyUrl(base, c.verification_code));
    // En desarrollo el QR apuntaría a localhost: se entrega, pero no se guarda.
    if (/localhost|127\.0\.0\.1/.test(base)) {
      return new NextResponse(bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
    }
    const sha = Buffer.from(await crypto.subtle.digest("SHA-256", bytes as BufferSource)).toString("hex");
    const path = `${c.number.split("-")[1] ?? "sin-anio"}/${c.number}-${sha.slice(0, 8)}.pdf`;
    try { await putObject(BUCKET, path, bytes, "application/pdf"); } catch { /* otra petición ya lo subió */ }
    const { data: f, error } = await admin.from("files").upsert({
      bucket: BUCKET, storage_path: path, original_name: name, extension: "pdf", mime_type: "application/pdf",
      size_bytes: bytes.byteLength, sha256: sha, status: "verified", uploaded_by: c.user_id,
    }, { onConflict: "bucket,storage_path" }).select("id").single();
    if (error || !f) return new NextResponse("No se pudo generar la constancia. Intenta de nuevo.", { status: 500 });
    const { data: attached } = await admin.rpc("attach_certificate_pdf", { p_id: c.id, p_file: f.id, p_sha256: sha });
    if (attached) fileId = f.id;
    else fileId = (await admin.from("certificates").select("pdf_file_id").eq("id", c.id).single()).data?.pdf_file_id ?? f.id;
  }
  const { data: file } = await admin.from("files").select("bucket, storage_path").eq("id", fileId!).single();
  if (!file) return new NextResponse("No encontrado", { status: 404 });
  const url = await signedReadUrl(file.bucket, file.storage_path, 300, name);
  return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
}
