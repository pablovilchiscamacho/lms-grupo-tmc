import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** URL firmada de lectura. Solo se llama después de autorizar con public.file_access. */
export async function signedReadUrl(bucket: string, path: string, ttlSeconds: number, downloadName?: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, ttlSeconds, downloadName ? { download: downloadName } : undefined);
  if (error || !data) throw error ?? new Error("signed url");
  return data.signedUrl;
}

/** URL firmada de subida (2 h). Solo después de public.file_prepare_upload. */
export async function signedUploadUrl(bucket: string, path: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("signed upload url");
  return data;
}

/** Lee los primeros bytes (para detectar el tipo real) sin descargar todo el archivo. */
export async function readHead(bucket: string, path: string, bytes = 4100) {
  const url = await signedReadUrl(bucket, path, 120);
  const res = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` } });
  if (!res.ok && res.status !== 206) throw new Error(`readHead ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function readAll(bucket: string, path: string) {
  const url = await signedReadUrl(bucket, path, 300);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`readAll ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function removeObject(bucket: string, path: string) {
  await createAdminClient().storage.from(bucket).remove([path]);
}

export async function putObject(bucket: string, path: string, body: Uint8Array, contentType: string) {
  const { error } = await createAdminClient().storage.from(bucket).upload(path, body, { contentType, upsert: false });
  if (error) throw error;
}
