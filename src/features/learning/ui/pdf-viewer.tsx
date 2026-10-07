"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/**
 * Visor de PDF/presentaciones página por página (como diapositivas). Reporta cada página vista.
 * El archivo llega por /api/files/[id], que autoriza y redirige a una URL firmada.
 */
export function PdfViewer({ fileId, startPage = 1, onPage }: { fileId: string; startPage?: number; onPage: (page: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const task = useRef<RenderTask | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(startPage);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const d = await pdfjs.getDocument({ url: `/api/files/${fileId}` }).promise;
        if (!cancelled) { setDoc(d); setPage((p) => Math.min(Math.max(p, 1), d.numPages)); }
      } catch {
        if (!cancelled) setError("No se pudo abrir el documento. Recarga la página.");
      }
    })();
    return () => { cancelled = true; };
  }, [fileId]);

  const render = useCallback(async () => {
    if (!doc || !canvas.current || !box.current) return;
    setRendering(true);
    task.current?.cancel();
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const width = box.current.clientWidth;
    const height = full ? window.innerHeight - 80 : Infinity;
    const scale = Math.min(width / base.width, height / base.height);
    const ratio = window.devicePixelRatio || 1;
    const viewport = p.getViewport({ scale: scale * ratio });
    const c = canvas.current;
    c.width = viewport.width;
    c.height = viewport.height;
    c.style.width = `${viewport.width / ratio}px`;
    c.style.height = `${viewport.height / ratio}px`;
    task.current = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport });
    try { await task.current.promise; } catch { /* render cancelado al cambiar de página */ }
    setRendering(false);
  }, [doc, page, full]);

  useEffect(() => { render(); }, [render]);
  useEffect(() => { if (doc) onPage(page); }, [doc, page, onPage]);
  useEffect(() => {
    const onResize = () => render();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [render]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") setPage((p) => Math.min(p + 1, doc?.numPages ?? p));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setPage((p) => Math.max(p - 1, 1));
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc]);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  const total = doc?.numPages ?? 0;
  return (
    <div className={full ? "fixed inset-0 z-50 flex flex-col bg-slate-900 p-3" : "space-y-2"}>
      <div ref={box} className={`relative flex justify-center overflow-hidden rounded-lg ${full ? "flex-1 items-center" : "bg-slate-100"}`}>
        {(!doc || rendering) && <Loader2 className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-slate-400" aria-label="Cargando" />}
        <canvas ref={canvas} className="max-w-full shadow-sm" aria-label={`Página ${page} de ${total}`} />
      </div>
      <div className={`flex items-center justify-between gap-2 ${full ? "text-white" : ""}`}>
        <button className={full ? "btn rounded-lg bg-white/10 text-white hover:bg-white/20" : "btn-secondary"} disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="size-4" /></button>
        <span className="text-sm tabular-nums" aria-live="polite">Página {page} de {total || "…"}</span>
        <div className="flex gap-2">
          <button className={full ? "btn rounded-lg bg-white/10 text-white hover:bg-white/20" : "btn-secondary"} onClick={() => setFull(!full)} aria-label={full ? "Salir de pantalla completa" : "Pantalla completa"}>
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <button className={full ? "btn rounded-lg bg-white/10 text-white hover:bg-white/20" : "btn-secondary"} disabled={!total || page >= total} onClick={() => setPage(page + 1)} aria-label="Página siguiente"><ChevronRight className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}
