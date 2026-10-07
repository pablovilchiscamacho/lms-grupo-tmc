import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signedReadUrl } from "@/lib/storage";

/**
 * Abre un archivo privado: autoriza con public.file_access (inscripción o gestión del curso)
 * y redirige a una URL firmada de corta duración. ?dl=1 fuerza la descarga con su nombre original.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("file_access", { p_file: id });
  if (error || !data) return new NextResponse("No tienes acceso a este archivo.", { status: error?.message === "FORBIDDEN" ? 403 : 404 });
  const f = data as { bucket: string; path: string; mime_type: string; name: string };
  const ttl = f.mime_type.startsWith("video/") ? 4 * 3600 : 600;
  const url = await signedReadUrl(f.bucket, f.path, ttl, request.nextUrl.searchParams.get("dl") ? f.name : undefined);
  return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
}
