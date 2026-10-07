import "server-only";

/**
 * Conversión de PowerPoint/Word a PDF con CloudConvert (§11, D10).
 * Sin CLOUDCONVERT_API_KEY la app sigue funcionando: el administrador puede subir el PDF a mano.
 */
const API = "https://api.cloudconvert.com/v2";
const key = () => process.env.CLOUDCONVERT_API_KEY ?? "";
export const conversionEnabled = () => key().length > 0;

export async function startConversion(sourceUrl: string, filename: string) {
  const res = await fetch(`${API}/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tag: "lms-grupo-tmc",
      tasks: {
        importar: { operation: "import/url", url: sourceUrl, filename },
        convertir: { operation: "convert", input: "importar", output_format: "pdf" },
        exportar: { operation: "export/url", input: "convertir" },
      },
    }),
  });
  if (!res.ok) throw new Error(`CloudConvert ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data: { id: string } };
  return json.data.id;
}

export type ConversionState = { status: "processing" } | { status: "failed"; error: string } | { status: "finished"; url: string };

export async function checkConversion(jobId: string): Promise<ConversionState> {
  const res = await fetch(`${API}/jobs/${encodeURIComponent(jobId)}`, { headers: { Authorization: `Bearer ${key()}` }, cache: "no-store" });
  if (!res.ok) return { status: "failed", error: `CloudConvert ${res.status}` };
  const { data } = (await res.json()) as {
    data: { status: string; tasks: { name: string; status: string; message?: string; result?: { files?: { url: string }[] } }[] };
  };
  if (data.status === "error") return { status: "failed", error: data.tasks.find((t) => t.status === "error")?.message ?? "Error de conversión" };
  if (data.status !== "finished") return { status: "processing" };
  const url = data.tasks.find((t) => t.name === "exportar")?.result?.files?.[0]?.url;
  return url ? { status: "finished", url } : { status: "failed", error: "Sin archivo de salida" };
}
