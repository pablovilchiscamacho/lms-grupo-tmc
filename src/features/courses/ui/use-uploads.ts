"use client";
import { useCallback, useState } from "react";
import { SUPABASE_PUBLISHABLE_KEY } from "@/lib/env";
import { addLessonFromFile, finalizeUpload, prepareUpload, type FinalizeResult } from "@/features/content/actions";

export type UploadItem = {
  key: string; name: string; size: number; progress: number;
  status: "hashing" | "uploading" | "verifying" | "done" | "reused" | "error";
  message?: string;
};

const HASH_LIMIT = 200 * 1024 * 1024; // más grande que esto no se calcula la huella (videos pesados)

async function sha256(file: File) {
  if (file.size > HASH_LIMIT) return null;
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function videoDuration(file: File): Promise<number | null> {
  if (!file.type.startsWith("video/")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); resolve(Number.isFinite(v.duration) ? Math.round(v.duration) : null); };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}

/** Sube directo a Storage con barra de avance (XHR); el servidor no recibe el archivo. */
function putWithProgress(url: string, file: File, contentType: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.status === 413 ? "El archivo supera el límite de Storage." : `Error ${xhr.status} al subir`)));
    xhr.onerror = () => reject(new Error("Se perdió la conexión al subir."));
    xhr.send(file);
  });
}

/**
 * "Arrastrar y listo": cada archivo se sube, se verifica y se vuelve una lección del módulo.
 * onUploaded recibe el id para casos especiales (por ejemplo, adjuntar un PDF a una presentación).
 */
export function useUploads(courseId: string, onDone: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const patch = (key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const uploadOne = useCallback(async (file: File, then: (fileId: string, fin: FinalizeResult | null) => Promise<string | null>) => {
    const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
    setItems((l) => [...l, { key, name: file.name, size: file.size, progress: 0, status: "hashing" }]);
    try {
      const [hash, duration] = await Promise.all([sha256(file), videoDuration(file)]);
      const prep = await prepareUpload({ courseId, name: file.name, size: file.size, sha256: hash, durationS: duration });
      if (!prep.ok) throw new Error(prep.error.message);
      const d = prep.data!;
      let fin: FinalizeResult | null = null;
      if (d.existing) {
        patch(key, { status: "reused", progress: 100, message: "Ya estaba subido: se reutilizó sin ocupar más espacio." });
      } else {
        patch(key, { status: "uploading", message: d.warnLargeVideo ? "Video pesado: considera exportarlo en 720p." : undefined });
        await putWithProgress(d.signedUrl, file, d.contentType, (p) => patch(key, { progress: p }));
        patch(key, { status: "verifying", progress: 100 });
        const f = await finalizeUpload(d.fileId);
        if (!f.ok) throw new Error(f.error.message);
        fin = f.data!;
        if (fin.status === "rejected") throw new Error("El contenido del archivo no coincide con su tipo y se rechazó.");
      }
      const err = await then(d.fileId, fin);
      if (err) throw new Error(err);
      patch(key, {
        status: d.existing ? "reused" : "done",
        message: fin?.conversion === "processing" ? "Convirtiendo a PDF…" : fin?.conversion === "manual" ? "Para verlo en pantalla, sube también el PDF." : d.existing ? "Reutilizado (no ocupa más espacio)." : undefined,
      });
      return d.fileId;
    } catch (e) {
      patch(key, { status: "error", message: e instanceof Error ? e.message : "No se pudo subir." });
      return null;
    }
  }, [courseId]);

  /** Varios archivos → varias lecciones, en el orden en que se soltaron. */
  const uploadAsLessons = useCallback(async (moduleId: string, files: File[]) => {
    for (const file of files) {
      await uploadOne(file, async (fileId) => {
        const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 160) || "Lección";
        const r = await addLessonFromFile(moduleId, fileId, title);
        return r.ok ? null : r.error.message;
      });
    }
    onDone();
  }, [uploadOne, onDone]);

  const clearFinished = () => setItems((l) => l.filter((i) => i.status === "uploading" || i.status === "hashing" || i.status === "verifying"));
  return { items, uploadOne, uploadAsLessons, clearFinished };
}
