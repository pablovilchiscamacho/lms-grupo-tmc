"use server";
import { revalidatePath } from "next/cache";
import { fileTypeFromBuffer } from "file-type";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { must, mustData, safe, UserError, type ActionResult } from "@/lib/action";
import { putObject, readAll, readHead, removeObject, signedReadUrl, signedUploadUrl } from "@/lib/storage";
import { checkConversion, conversionEnabled, startConversion } from "@/lib/conversion";
import { sanitizeLessonHtml } from "@/lib/sanitize";

const uuid = z.string().uuid();
const CONVERTIBLE = new Set(["ppt", "pptx", "doc", "docx"]);

/** Tipos reales aceptados por extensión (detectados por "magic bytes", no por lo que dice el navegador). */
const EXPECTED: Record<string, string[]> = {
  pdf: ["application/pdf"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"],
  ppt: ["application/x-cfb"], doc: ["application/x-cfb"], xls: ["application/x-cfb"],
  mp4: ["video/mp4"],
  jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"], webp: ["image/webp"],
};
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", mp4: "video/mp4", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const prepareSchema = z.object({
  courseId: uuid,
  name: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  durationS: z.number().int().positive().max(36000).nullable(),
});

export type PreparedUpload =
  | { existing: true; fileId: string }
  | { existing: false; fileId: string; signedUrl: string; contentType: string; warnLargeVideo: boolean };

/** Paso 1: reserva el archivo y entrega una URL firmada para subirlo directo a Storage (sin pasar por Vercel). */
export async function prepareUpload(input: z.infer<typeof prepareSchema>): Promise<ActionResult<PreparedUpload>> {
  return safe<PreparedUpload>(async () => {
    const v = prepareSchema.parse(input);
    const ext = (v.name.split(".").pop() ?? "").toLowerCase();
    if (!MIME_BY_EXT[ext]) throw new UserError("Ese tipo de archivo no está permitido. Usa PDF, PowerPoint, Word, Excel, MP4, JPG o PNG.");
    const supabase = await createClient();
    const res = must(await supabase.rpc("file_prepare_upload", {
      p: { course_id: v.courseId, name: v.name, extension: ext, size_bytes: v.size, sha256: v.sha256, mime_type: MIME_BY_EXT[ext], duration_s: v.durationS },
    })) as { existing_file_id?: string; file_id?: string; path?: string; warn_large_video?: boolean };
    if (res.existing_file_id) return { ok: true, data: { existing: true, fileId: res.existing_file_id } };
    const up = await signedUploadUrl("course-content", res.path!);
    return { ok: true, data: { existing: false, fileId: res.file_id!, signedUrl: up.signedUrl, contentType: MIME_BY_EXT[ext], warnLargeVideo: !!res.warn_large_video } };
  });
}

export type FinalizeResult = { status: "verified" | "rejected"; conversion: "pending" | "processing" | "not_needed" | "manual"; pageCount: number | null };

/** Paso 2: verifica el tipo real del archivo subido, cuenta páginas de PDF y arranca la conversión a PDF si aplica. */
export async function finalizeUpload(fileId: string): Promise<ActionResult<FinalizeResult>> {
  return safe<FinalizeResult>(async () => {
    uuid.parse(fileId);
    const supabase = await createClient();
    const { data: f, error } = await supabase.from("files").select("id, bucket, storage_path, extension, size_bytes, status, original_name, uploaded_by")
      .eq("id", fileId).maybeSingle();
    if (error) throw error;
    const { data: me } = await supabase.auth.getClaims();
    if (!f || f.uploaded_by !== me?.claims?.sub) throw new UserError("No encontramos el archivo.", "NOT_FOUND");
    if (f.status !== "pending_upload") return { ok: true, data: { status: f.status as "verified", conversion: "not_needed", pageCount: null } };

    const admin = createAdminClient();
    let ok = false;
    let detected: string | undefined;
    try {
      detected = (await fileTypeFromBuffer(await readHead(f.bucket, f.storage_path)))?.mime;
      ok = !!detected && (EXPECTED[f.extension] ?? []).includes(detected);
    } catch {
      ok = false;
    }
    let pageCount: number | null = null;
    if (ok && f.extension === "pdf" && f.size_bytes <= 150 * 1024 * 1024) {
      try {
        pageCount = (await PDFDocument.load(await readAll(f.bucket, f.storage_path), { ignoreEncryption: true, updateMetadata: false })).getPageCount();
      } catch {
        pageCount = null;
      }
    }
    must(await admin.rpc("file_finalize", { p_file: fileId, p: { ok, mime_type: ok ? MIME_BY_EXT[f.extension] : detected ?? "desconocido", page_count: pageCount } }));
    if (!ok) {
      await removeObject(f.bucket, f.storage_path);
      return { ok: true, data: { status: "rejected", conversion: "not_needed", pageCount: null } };
    }
    let conversion: FinalizeResult["conversion"] = "not_needed";
    if (CONVERTIBLE.has(f.extension)) {
      if (conversionEnabled()) {
        try {
          const jobId = await startConversion(await signedReadUrl(f.bucket, f.storage_path, 3600), f.original_name);
          must(await admin.rpc("file_conversion_update", { p_file: fileId, p: { status: "processing", job_id: jobId } }));
          conversion = "processing";
        } catch (e) {
          console.error("[conversion:start]", e);
          await admin.rpc("file_conversion_update", { p_file: fileId, p: { status: "failed", error: "No se pudo iniciar la conversión" } });
          conversion = "manual";
        }
      } else {
        conversion = "manual";
      }
    }
    return { ok: true, data: { status: "verified", conversion, pageCount } };
  });
}

/** Consulta el avance de la conversión a PDF; al terminar guarda el PDF y lo liga a la lección. */
export async function pollConversion(fileId: string): Promise<ActionResult<{ status: string }>> {
  return safe(async () => {
    uuid.parse(fileId);
    const supabase = await createClient();
    const { data: f } = await supabase.from("files").select("id, course_id, conversion_status, conversion_job_id").eq("id", fileId).maybeSingle();
    if (!f) throw new UserError("No encontramos el archivo.", "NOT_FOUND");
    if (f.conversion_status !== "processing" || !f.conversion_job_id) return { ok: true, data: { status: f.conversion_status ?? "not_needed" } };
    const admin = createAdminClient();
    const st = await checkConversion(f.conversion_job_id);
    if (st.status === "processing") return { ok: true, data: { status: "processing" } };
    if (st.status === "failed") {
      must(await admin.rpc("file_conversion_update", { p_file: fileId, p: { status: "failed", error: st.error.slice(0, 300) } }));
      return { ok: true, data: { status: "failed" } };
    }
    const pdf = new Uint8Array(await (await fetch(st.url)).arrayBuffer());
    const path = `${f.course_id}/${crypto.randomUUID()}.pdf`;
    await putObject("course-content", path, pdf, "application/pdf");
    let pages: number | null = null;
    try { pages = (await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false })).getPageCount(); } catch { pages = null; }
    must(await admin.rpc("file_conversion_update", { p_file: fileId, p: { status: "done", pdf_path: path, pdf_size: pdf.byteLength, page_count: pages } }));
    revalidatePath(`/admin/cursos/${f.course_id}`);
    return { ok: true, data: { status: "done" } };
  });
}

// ─────────────────────────────── Estructura del curso ───────────────────────────────

const RULE_BY_EXT: Record<string, { type: string; rule: string }> = {
  pdf: { type: "pdf", rule: "all_pages" }, ppt: { type: "presentation", rule: "all_pages" }, pptx: { type: "presentation", rule: "all_pages" },
  doc: { type: "document", rule: "all_pages" }, docx: { type: "document", rule: "all_pages" },
  xls: { type: "spreadsheet", rule: "manual" }, xlsx: { type: "spreadsheet", rule: "manual" },
  mp4: { type: "video", rule: "video_percent" }, jpg: { type: "image", rule: "on_view" }, jpeg: { type: "image", rule: "on_view" },
  png: { type: "image", rule: "on_view" }, webp: { type: "image", rule: "on_view" },
};

async function revalidateCourse(supabase: Awaited<ReturnType<typeof createClient>>, moduleId: string) {
  const { data } = await supabase.from("course_modules").select("course_versions(course_id)").eq("id", moduleId).maybeSingle();
  const courseId = (data?.course_versions as unknown as { course_id: string } | null)?.course_id;
  if (courseId) revalidatePath(`/admin/cursos/${courseId}`);
}

export async function addModule(versionId: string, title: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(versionId);
    const t = z.string().trim().min(1, "Escribe un nombre").max(160).parse(title);
    const supabase = await createClient();
    const { data: last } = await supabase.from("course_modules").select("position").eq("course_version_id", versionId).order("position", { ascending: false }).limit(1).maybeSingle();
    const ins = mustData(await supabase.from("course_modules").insert({ course_version_id: versionId, title: t, position: (last?.position ?? 0) + 1 }).select("id").single());
    await revalidateCourse(supabase, ins.id);
  });
}

export async function updateModule(id: string, patch: { title?: string; is_required?: boolean }): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(id);
    const v = z.object({ title: z.string().trim().min(1).max(160).optional(), is_required: z.boolean().optional() }).parse(patch);
    const supabase = await createClient();
    const r = mustData(await supabase.from("course_modules").update(v).eq("id", id).select("id"));
    if (!r.length) throw new UserError("No tienes permiso para editar este módulo.", "FORBIDDEN");
    await revalidateCourse(supabase, id);
  });
}

export async function deleteModule(id: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(id);
    const supabase = await createClient();
    await revalidateCourse(supabase, id);
    must(await supabase.from("course_modules").delete().eq("id", id));
  });
}

const lessonSchema = z.object({
  title: z.string().trim().min(1, "Escribe un título").max(160).optional(),
  completion_rule: z.enum(["manual", "on_view", "min_time", "video_percent", "all_pages"]).optional(),
  min_seconds: z.number().int().min(5).max(36000).nullable().optional(),
  min_video_pct: z.number().min(10).max(100).optional(),
  is_required: z.boolean().optional(),
});

async function nextLessonPosition(supabase: Awaited<ReturnType<typeof createClient>>, moduleId: string) {
  const { data } = await supabase.from("lessons").select("position").eq("module_id", moduleId).order("position", { ascending: false }).limit(1).maybeSingle();
  return (data?.position ?? 0) + 1;
}

export async function addTextLesson(moduleId: string, title: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(moduleId);
    const t = z.string().trim().min(1, "Escribe un título").max(160).parse(title);
    const supabase = await createClient();
    const lesson = mustData(await supabase.from("lessons").insert({ module_id: moduleId, title: t, position: await nextLessonPosition(supabase, moduleId), completion_rule: "manual" }).select("id").single());
    must(await supabase.from("lesson_contents").insert({ lesson_id: lesson.id, type: "text", body_html: "<p></p>" }));
    await revalidateCourse(supabase, moduleId);
  });
}

export async function addLinkLesson(moduleId: string, title: string, url: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(moduleId);
    const t = z.string().trim().min(1, "Escribe un título").max(160).parse(title);
    const u = z.string().trim().url("Escribe una dirección válida").refine((x) => x.startsWith("https://"), "La dirección debe empezar con https://").parse(url);
    const supabase = await createClient();
    const lesson = mustData(await supabase.from("lessons").insert({ module_id: moduleId, title: t, position: await nextLessonPosition(supabase, moduleId), completion_rule: "on_view" }).select("id").single());
    must(await supabase.from("lesson_contents").insert({ lesson_id: lesson.id, type: "link", url: u }));
    await revalidateCourse(supabase, moduleId);
  });
}

/** "Arrastrar y listo": cada archivo subido se vuelve una lección con la regla de completado adecuada a su tipo. */
export async function addLessonFromFile(moduleId: string, fileId: string, title: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(moduleId); uuid.parse(fileId);
    const t = z.string().trim().min(1).max(160).parse(title);
    const supabase = await createClient();
    const { data: f } = await supabase.from("files").select("extension, converted_pdf_id, page_count, status").eq("id", fileId).maybeSingle();
    if (!f || f.status !== "verified") throw new UserError("El archivo no se pudo verificar.");
    const kind = RULE_BY_EXT[f.extension];
    const hasPdf = f.extension === "pdf" || !!f.converted_pdf_id;
    const rule = kind.rule === "all_pages" && !hasPdf && !CONVERTIBLE.has(f.extension) ? "manual" : kind.rule;
    const lesson = mustData(await supabase.from("lessons").insert({ module_id: moduleId, title: t, position: await nextLessonPosition(supabase, moduleId), completion_rule: rule }).select("id").single());
    must(await supabase.from("lesson_contents").insert({ lesson_id: lesson.id, type: kind.type, file_id: fileId, pdf_file_id: f.converted_pdf_id ?? null }));
    await revalidateCourse(supabase, moduleId);
  });
}

export async function updateLesson(id: string, patch: z.infer<typeof lessonSchema>): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(id);
    const v = lessonSchema.parse(patch);
    if (v.completion_rule === "min_time" && v.min_seconds == null) v.min_seconds = 60;
    const supabase = await createClient();
    const r = mustData(await supabase.from("lessons").update(v).eq("id", id).select("module_id"));
    if (!r.length) throw new UserError("No tienes permiso para editar esta lección.", "FORBIDDEN");
    await revalidateCourse(supabase, r[0].module_id);
  });
}

export async function deleteLesson(id: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(id);
    const supabase = await createClient();
    const r = mustData(await supabase.from("lessons").delete().eq("id", id).select("module_id"));
    if (r[0]) await revalidateCourse(supabase, r[0].module_id);
  });
}

export async function saveTextContent(contentId: string, html: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(contentId);
    const clean = sanitizeLessonHtml(z.string().max(400_000).parse(html));
    const supabase = await createClient();
    const r = mustData(await supabase.from("lesson_contents").update({ body_html: clean }).eq("id", contentId).select("id"));
    if (!r.length) throw new UserError("No tienes permiso para editar este contenido.", "FORBIDDEN");
    return { ok: true, message: "Guardado." };
  });
}

/** Liga a mano un PDF a una presentación o documento (cuando no hay conversión automática). */
export async function attachPdf(contentId: string, pdfFileId: string): Promise<ActionResult> {
  return safe(async () => {
    uuid.parse(contentId); uuid.parse(pdfFileId);
    const supabase = await createClient();
    const { data: f } = await supabase.from("files").select("extension, status").eq("id", pdfFileId).maybeSingle();
    if (!f || f.extension !== "pdf" || f.status !== "verified") throw new UserError("Sube un archivo PDF válido.");
    const r = mustData(await supabase.from("lesson_contents").update({ pdf_file_id: pdfFileId }).eq("id", contentId).select("lesson_id"));
    if (!r.length) throw new UserError("No tienes permiso para editar este contenido.", "FORBIDDEN");
  });
}

export async function reorder(kind: "module" | "lesson", ids: string[]): Promise<ActionResult> {
  return safe(async () => {
    z.array(uuid).min(1).max(500).parse(ids);
    const supabase = await createClient();
    must(await supabase.rpc("reorder_items", { p_kind: kind, p_ids: ids }));
  });
}
