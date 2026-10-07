"use client";
import Link from "next/link";
import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDot, ClipboardList, Clock, Download, ExternalLink, List, Loader2, Lock, X } from "lucide-react";
import { Alert } from "@/components/ui";
import type { Player, PlayerContent, PlayerLesson } from "../queries";
import { completeLesson } from "../actions";
import { useLessonTracker } from "./use-tracker";
import { PdfViewer } from "./pdf-viewer";

const RULE_HINT: Record<string, (l: PlayerLesson) => string> = {
  manual: () => "Cuando termines, pulsa «Marcar como completado».",
  on_view: () => "Se completa al abrirla.",
  min_time: (l) => `Se completa después de ${Math.round((l.min_seconds ?? 60) / 60)} min de estudio.`,
  video_percent: (l) => `Se completa al ver al menos el ${Math.round(l.min_video_pct)} % del video.`,
  all_pages: () => "Se completa al revisar todas las páginas.",
};

export function PlayerView({ player, lessonId }: { player: Player; lessonId: string }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const all = player.modules.flatMap((m) => m.lessons);
  const idx = all.findIndex((l) => l.id === lessonId);
  const lesson = all[idx];
  const prev = all[idx - 1];
  const next = all[idx + 1];
  const [done, setDone] = useState(lesson.status === "completed");
  const [prevLesson, setPrevLesson] = useState(lessonId);
  if (prevLesson !== lessonId) { setPrevLesson(lessonId); setDone(lesson.status === "completed"); }
  const onCompleted = () => { setDone(true); router.refresh(); };
  const { state, error, report } = useLessonTracker(lesson.id, onCompleted);
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const nextLocked = next && player.sequential && lesson.is_required && !done;
  const base = `/cursos/${player.enrollment.id}`;
  const pendingExam = player.exams.find((x) => !x.passed);

  const Sidebar = (
    <nav aria-label="Contenido del curso" className="space-y-4">
      {player.modules.map((m, mi) => (
        <div key={m.id}>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Módulo {mi + 1} · {m.title}</p>
          <ul className="space-y-0.5">
            {m.lessons.map((l) => {
              const current = l.id === lesson.id;
              const status = current && done ? "completed" : l.status;
              const icon = l.locked && !current ? <Lock className="size-4 text-slate-400" /> : status === "completed" ? <CheckCircle2 className="size-4 text-emerald-600" />
                : current ? <CircleDot className="size-4 text-brand-600" /> : <Circle className="size-4 text-slate-300" />;
              const cls = clsx("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm", current ? "bg-brand-50 font-medium text-brand-900" : "text-slate-700");
              return (
                <li key={l.id}>
                  {l.locked && !current ? (
                    <span className={clsx(cls, "cursor-not-allowed text-slate-400")} title="Completa primero las lecciones anteriores">{icon}<span className="truncate">{l.title}</span></span>
                  ) : (
                    <Link href={`${base}/leccion/${l.id}`} onClick={() => setMenu(false)} aria-current={current ? "page" : undefined} className={clsx(cls, "hover:bg-slate-100")}>{icon}<span className="truncate">{l.title}</span></Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {player.exams.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Evaluación</p>
          <ul className="space-y-0.5">
            {player.exams.map((x) => {
              const icon = x.passed ? <CheckCircle2 className="size-4 text-emerald-600" /> : x.pending ? <Clock className="size-4 text-amber-500" /> : x.locked ? <Lock className="size-4 text-slate-400" /> : <ClipboardList className="size-4 text-brand-600" />;
              return (
                <li key={x.id}>
                  {x.locked ? <span className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-400" title="Primero termina las lecciones">{icon}<span className="truncate">{x.title}</span></span>
                    : <Link href={`${base}/examen/${x.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">{icon}<span className="truncate">{x.title}</span></Link>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </nav>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="hidden lg:block">
        <div className="sticky top-20 card max-h-[calc(100vh-6rem)] overflow-y-auto p-4">
          <Link href="/cursos" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><ChevronLeft className="size-3.5" /> Mis cursos</Link>
          <p className="mb-1 font-semibold text-slate-900">{player.enrollment.course?.title}</p>
          <div className="mb-4 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500" style={{ width: `${player.enrollment.progress_pct}%` }} /></div>
            <span className="text-xs tabular-nums text-slate-500">{Math.round(player.enrollment.progress_pct)}%</span>
          </div>
          {Sidebar}
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex items-center justify-between gap-3 lg:hidden">
          <Link href="/cursos" className="inline-flex items-center gap-1 text-sm text-slate-500"><ChevronLeft className="size-4" /> Mis cursos</Link>
          <button className="btn-secondary py-1.5 text-xs" onClick={() => setMenu(true)}><List className="size-4" /> Contenido ({Math.round(player.enrollment.progress_pct)}%)</button>
        </div>
        {menu && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Contenido del curso">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenu(false)} />
            <div className="absolute inset-y-0 right-0 w-80 max-w-[85vw] overflow-y-auto bg-white p-4">
              <div className="mb-3 flex items-center justify-between"><p className="font-semibold">{player.enrollment.course?.title}</p>
                <button className="rounded p-1.5 hover:bg-slate-100" onClick={() => setMenu(false)} aria-label="Cerrar"><X className="size-5" /></button></div>
              {Sidebar}
            </div>
          </div>
        )}

        <header>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{lesson.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{done ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" /> Completada</span> : RULE_HINT[lesson.completion_rule]?.(lesson)}</p>
        </header>
        {(error || actionError) && <Alert kind="error">{error ?? actionError}</Alert>}

        <div className="space-y-4">
          {lesson.contents.map((c) => <ContentView key={c.id} content={c} lesson={lesson} report={report} />)}
        </div>

        {lesson.completion_rule === "all_pages" && !done && state && (
          <p className="text-xs text-slate-500">Páginas revisadas: {state.pages}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          {prev ? <Link href={`${base}/leccion/${prev.id}`} className="btn-secondary"><ChevronLeft className="size-4" /> Anterior</Link> : <span />}
          <div className="flex flex-wrap items-center gap-2">
            {!done && lesson.completion_rule === "manual" && (
              <button className="btn-primary" disabled={pending} onClick={() => start(async () => {
                const r = await completeLesson(lesson.id);
                if (r.ok) { setDone(true); setActionError(null); router.refresh(); } else setActionError(r.error.message);
              })}>{pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Marcar como completado</button>
            )}
            {next ? (
              nextLocked ? <span className="btn-secondary cursor-not-allowed opacity-50" title="Completa esta lección para continuar">Siguiente <Lock className="size-4" /></span>
                : <Link href={`${base}/leccion/${next.id}`} className={done ? "btn-primary" : "btn-secondary"}>Siguiente <ChevronRight className="size-4" /></Link>
            ) : pendingExam ? (
              <Link href={`${base}/examen/${pendingExam.id}`} className={done ? "btn-primary" : "btn-secondary"}><ClipboardList className="size-4" /> Ir al examen</Link>
            ) : (
              <Link href="/cursos" className={done ? "btn-primary" : "btn-secondary"}>Terminar</Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContentView({ content: c, lesson, report }: { content: PlayerContent; lesson: PlayerLesson; report: ReturnType<typeof useLessonTracker>["report"] }) {
  const onPage = useCallback((page: number) => report({ page, resume: { page } }, true), [report]);
  const pdfId = c.type === "pdf" ? c.file?.id : c.pdf?.id;

  if (c.type === "text") {
    // body_html se sanitiza en el servidor al guardarse (lista blanca, sin scripts ni estilos).
    return <article className="card lesson-html p-5" dangerouslySetInnerHTML={{ __html: c.body_html ?? "" }} />;
  }
  if (pdfId) {
    return (
      <div className="space-y-2">
        <PdfViewer fileId={pdfId} startPage={Number(lesson.resume?.page ?? 1)} onPage={onPage} />
        {c.file && c.file.extension !== "pdf" && (
          <a href={`/api/files/${c.file.id}?dl=1`} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"><Download className="size-3.5" /> Descargar el original ({c.file.original_name})</a>
        )}
      </div>
    );
  }
  if (c.type === "video" && c.file) return <VideoView fileId={c.file.id} resume={Number(lesson.resume?.t ?? 0)} report={report} />;
  if (c.type === "image" && c.file) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/files/${c.file.id}`} alt={lesson.title} className="mx-auto max-h-[70vh] rounded-lg border border-slate-200" />;
  }
  if (c.type === "link" && c.url) {
    return (
      <div className="card flex flex-col items-start gap-3 p-5">
        <p className="text-sm text-slate-600">Este contenido está en otro sitio. Se abre en una pestaña nueva.</p>
        <a href={c.url} target="_blank" rel="noopener noreferrer" className="btn-primary"><ExternalLink className="size-4" /> Abrir enlace</a>
        <p className="break-all text-xs text-slate-400">{c.url}</p>
      </div>
    );
  }
  if (c.file) {
    return (
      <div className="card flex flex-col items-start gap-3 p-5">
        <p className="text-sm text-slate-600">Descarga el archivo para revisarlo.</p>
        <a href={`/api/files/${c.file.id}?dl=1`} className="btn-primary"><Download className="size-4" /> Descargar {c.file.original_name}</a>
      </div>
    );
  }
  return null;
}

function VideoView({ fileId, resume, report }: { fileId: string; resume: number; report: ReturnType<typeof useLessonTracker>["report"] }) {
  const max = useRef(0);
  return (
    <video
      controls
      playsInline
      preload="metadata"
      className="w-full rounded-lg bg-black"
      src={`/api/files/${fileId}`}
      controlsList="nodownload"
      onLoadedMetadata={(e) => { if (resume > 5 && resume < e.currentTarget.duration - 5) e.currentTarget.currentTime = resume; }}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (!v.duration) return;
        // Se reporta el punto más lejano visto; el servidor lo acota al tiempo real transcurrido.
        max.current = Math.max(max.current, (v.currentTime / v.duration) * 100);
        report({ video_pct: Math.round(max.current * 10) / 10, resume: { t: Math.round(v.currentTime) } });
      }}
    >
      Tu navegador no puede reproducir este video.
    </video>
  );
}
