"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackLesson, type TrackResult } from "../actions";

const BEAT_MS = 20_000;

/**
 * Registra la lección: "open" al entrar y un latido cada 20 s mientras la pestaña está visible.
 * El servidor decide cuánto tiempo cuenta (máximo 60 s por latido) y si la lección quedó completada.
 */
export function useLessonTracker(lessonId: string, onCompleted: () => void) {
  const [state, setState] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = useRef<{ video_pct?: number; resume?: Record<string, number | string> }>({});
  const pendingPages = useRef<Set<number>>(new Set()); // páginas vistas que el servidor aún no acepta
  const completed = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);
  const lastSent = useRef(0);

  const handle = useCallback((r: Awaited<ReturnType<typeof trackLesson>>) => {
    if (!r.ok) { setError(r.error.message); return; }
    setState(r.data!);
    for (const pg of r.data!.pages_list ?? []) pendingPages.current.delete(pg);
    if (r.data!.status === "completed" && !completed.current) { completed.current = true; onCompletedRef.current(); }
  }, []);

  const beat = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    lastSent.current = Date.now();
    handle(await trackLesson(lessonId, "heartbeat", { ...data.current, pages: [...pendingPages.current].slice(0, 200) }));
  }, [lessonId, handle]);

  useEffect(() => {
    completed.current = false;
    let alive = true;
    trackLesson(lessonId, "open").then((r) => { if (alive) { if (r.ok) completed.current = r.data!.status === "completed"; handle(r); } });
    const t = setInterval(beat, BEAT_MS);
    const onVis = () => document.visibilityState === "hidden" && Date.now() - lastSent.current > 5000 && beat();
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [lessonId, beat, handle]);

  /** Actualiza lo que se reportará (página del PDF, % de video). Las páginas se envían de inmediato. */
  const report = useCallback((d: typeof data.current & { page?: number }, immediate = false) => {
    const { page, ...rest } = d;
    if (page) pendingPages.current.add(page);
    data.current = { ...data.current, ...rest };
    if (immediate && Date.now() - lastSent.current > 1500) beat();
  }, [beat]);

  return { state, error, report };
}
