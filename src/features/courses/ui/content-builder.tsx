"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileText, FileVideo, GripVertical, Image as ImageIcon, Link2,
  Loader2, Lock, Plus, Presentation, Sheet, Trash2, Type, UploadCloud, XCircle,
} from "lucide-react";
import { fmtBytes, RULE_LABEL } from "@/lib/format";
import { Alert, Badge } from "@/components/ui";
import type { ContentRow, LessonRow, ModuleRow } from "../queries";
import {
  addLinkLesson, addModule, addTextLesson, attachPdf, deleteLesson, deleteModule, pollConversion, reorder, updateLesson, updateModule,
} from "@/features/content/actions";
import { startNewVersion } from "../actions";
import { TextEditor } from "./text-editor";
import { useUploads, type UploadItem } from "./use-uploads";

const ACCEPT = ".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.mp4,.jpg,.jpeg,.png,.webp";
const TYPE_ICON: Record<string, typeof FileText> = {
  text: Type, pdf: FileText, presentation: Presentation, document: FileText, spreadsheet: Sheet, video: FileVideo, image: ImageIcon, link: Link2, download: FileText,
};

export function ContentBuilder({ courseId, versionId, versionNumber, locked, modules, conversionEnabled }: {
  courseId: string; versionId: string; versionNumber: number; locked: boolean; modules: ModuleRow[]; conversionEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState(modules.map((m) => m.id));
  const [prevModules, setPrevModules] = useState(modules);
  if (modules !== prevModules) { setPrevModules(modules); setOrder(modules.map((m) => m.id)); }
  const refresh = () => router.refresh();
  const uploads = useUploads(courseId, refresh);
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => { const r = await fn(); if (!r.ok) setError(r.error?.message ?? "Error"); else { setError(null); refresh(); } });

  // Conversión a PDF en curso: se consulta cada 5 s hasta terminar.
  const converting = modules.flatMap((m) => m.lessons.flatMap((l) => l.contents)).filter((c) => c.file?.conversion_status === "processing").map((c) => c.file!.id);
  const convKey = converting.join(",");
  useEffect(() => {
    if (!convKey) return;
    const t = setInterval(async () => {
      for (const id of convKey.split(",")) {
        const r = await pollConversion(id);
        if (r.ok && r.data?.status !== "processing") router.refresh();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [convKey, router]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onModuleDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
    setOrder(next);
    run(() => reorder("module", next));
  };
  const byId = new Map(modules.map((m) => [m.id, m]));

  return (
    <div className="space-y-4">
      {locked && (
        <Alert kind="info" title={`Estás viendo la versión ${versionNumber}, ya publicada`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Para no alterar el historial de quienes ya la tomaron, los cambios se hacen en una versión nueva. Los archivos se reutilizan.</span>
            <button className="btn-primary" disabled={pending} onClick={() => run(() => startNewVersion(courseId))}>
              {pending && <Loader2 className="size-4 animate-spin" />} Editar contenido (versión {versionNumber + 1})
            </button>
          </div>
        </Alert>
      )}
      {!conversionEnabled && !locked && (
        <Alert kind="info">Las presentaciones de PowerPoint se pueden descargar. Para que se vean en pantalla y se cuente qué páginas se revisaron, adjunta también su PDF (botón «Subir PDF» en la lección).</Alert>
      )}
      {error && <Alert kind="error">{error}</Alert>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onModuleDrag}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {order.map((id, i) => byId.get(id) && (
            <ModuleCard key={id} index={i + 1} module={byId.get(id)!} locked={locked} pending={pending} run={run}
              onFiles={(files) => uploads.uploadAsLessons(id, files)} uploadOne={uploads.uploadOne} sensors={sensors} />
          ))}
        </SortableContext>
      </DndContext>

      {uploads.items.length > 0 && <UploadList items={uploads.items} onClear={uploads.clearFinished} />}

      {!locked && <AddModule onAdd={(t) => run(() => addModule(versionId, t))} pending={pending} />}
    </div>
  );
}

function ModuleCard({ module: m, index, locked, pending, run, onFiles, uploadOne, sensors }: {
  module: ModuleRow; index: number; locked: boolean; pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;
  onFiles: (files: File[]) => void; uploadOne: ReturnType<typeof useUploads>["uploadOne"]; sensors: ReturnType<typeof useSensors>;
}) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id: m.id, disabled: locked });
  const [lessonOrder, setLessonOrder] = useState(m.lessons.map((l) => l.id));
  const [prev, setPrev] = useState(m.lessons);
  if (m.lessons !== prev) { setPrev(m.lessons); setLessonOrder(m.lessons.map((l) => l.id)); }
  const [drag, setDrag] = useState(false);
  const [adding, setAdding] = useState<null | "text" | "link">(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lessons = new Map(m.lessons.map((l) => [l.id, l]));

  const onLessonDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(lessonOrder, lessonOrder.indexOf(String(e.active.id)), lessonOrder.indexOf(String(e.over.id)));
    setLessonOrder(next);
    run(() => reorder("lesson", next));
  };

  return (
    <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx("card", isDragging && "z-10 shadow-lg")}>
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        {!locked && <button className="cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100" {...attributes} {...listeners} aria-label={`Mover módulo ${m.title}`}><GripVertical className="size-4" /></button>}
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Módulo {index}</span>
        {locked ? <h3 className="flex-1 text-sm font-semibold text-slate-800">{m.title}</h3> : (
          <input defaultValue={m.title} aria-label="Nombre del módulo" className="flex-1 rounded border border-transparent px-1.5 py-0.5 text-sm font-semibold text-slate-800 hover:border-slate-200 focus:border-brand-500 focus:outline-none"
            onBlur={(e) => e.target.value.trim() && e.target.value !== m.title && run(() => updateModule(m.id, { title: e.target.value }))} />
        )}
        {!locked && (
          <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" disabled={pending} aria-label={`Borrar módulo ${m.title}`}
            onClick={() => confirm(`¿Borrar el módulo «${m.title}» y sus lecciones?`) && run(() => deleteModule(m.id))}><Trash2 className="size-4" /></button>
        )}
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLessonDrag}>
        <SortableContext items={lessonOrder} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-slate-100">
            {lessonOrder.map((id) => lessons.get(id) && (
              <LessonItem key={id} lesson={lessons.get(id)!} locked={locked} pending={pending} run={run} uploadOne={uploadOne} />
            ))}
            {m.lessons.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Sin lecciones todavía.</li>}
          </ul>
        </SortableContext>
      </DndContext>

      {!locked && (
        <div className="space-y-2 p-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles([...e.dataTransfer.files]); }}
            className={clsx("flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition",
              drag ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 text-slate-500")}>
            <UploadCloud className="size-6" aria-hidden />
            <p><span className="font-medium text-slate-700">Arrastra aquí tus archivos</span> (PowerPoint, PDF, Word, Excel, video MP4 o imágenes)</p>
            <p className="text-xs">Cada archivo se convierte en una lección, en el orden en que los sueltes.</p>
            <button type="button" className="btn-secondary mt-2" onClick={() => fileInput.current?.click()}>Elegir archivos</button>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost text-xs" onClick={() => setAdding("text")}><Plus className="size-3.5" /> Lección de texto</button>
            <button className="btn-ghost text-xs" onClick={() => setAdding("link")}><Plus className="size-3.5" /> Enlace externo</button>
          </div>
          {adding && <QuickAdd kind={adding} onCancel={() => setAdding(null)}
            onSave={(title, url) => { setAdding(null); run(() => (adding === "text" ? addTextLesson(m.id, title) : addLinkLesson(m.id, title, url!))); }} />}
        </div>
      )}
    </section>
  );
}

function LessonItem({ lesson: l, locked, pending, run, uploadOne }: {
  lesson: LessonRow; locked: boolean; pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void; uploadOne: ReturnType<typeof useUploads>["uploadOne"];
}) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id: l.id, disabled: locked });
  const [open, setOpen] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const c: ContentRow | undefined = l.contents[0];
  const Icon = TYPE_ICON[c?.type ?? "text"] ?? FileText;
  const needsPdf = c && (c.type === "presentation" || c.type === "document") && !c.pdf;
  const conv = c?.file?.conversion_status;

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={clsx("bg-white", isDragging && "relative z-10 shadow")}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {!locked && <button className="cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100" {...attributes} {...listeners} aria-label={`Mover lección ${l.title}`}><GripVertical className="size-4" /></button>}
        <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Ver detalle">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <Icon className="size-4 shrink-0 text-slate-500" aria-hidden />
        {locked ? <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{l.title}</span> : (
          <input defaultValue={l.title} aria-label="Título de la lección" className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-0.5 text-sm text-slate-800 hover:border-slate-200 focus:border-brand-500 focus:outline-none"
            onBlur={(e) => e.target.value.trim() && e.target.value !== l.title && run(() => updateLesson(l.id, { title: e.target.value }))} />
        )}
        {conv === "processing" && <Badge tone="blue"><Loader2 className="mr-1 size-3 animate-spin" /> Convirtiendo a PDF</Badge>}
        {conv === "failed" && <Badge tone="red">La conversión falló</Badge>}
        {needsPdf && conv !== "processing" && <Badge tone="amber">Sin PDF</Badge>}
        {c?.file && c.file.status !== "verified" && <Badge tone="red">Archivo no verificado</Badge>}
        {!l.is_required && <Badge>Opcional</Badge>}
        <span className="hidden text-xs text-slate-400 sm:inline">{RULE_LABEL[l.completion_rule]}</span>
        {!locked && (
          <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" disabled={pending} aria-label={`Borrar lección ${l.title}`}
            onClick={() => confirm(`¿Borrar la lección «${l.title}»?`) && run(() => deleteLesson(l.id))}><Trash2 className="size-4" /></button>
        )}
      </div>

      {open && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:pl-14">
          {c?.file && (
            <p className="text-xs text-slate-600">
              <a href={`/api/files/${c.file.id}?dl=1`} className="font-medium text-brand-700 hover:underline">{c.file.original_name}</a> · {fmtBytes(c.file.size_bytes)}
              {c.pdf && <> · PDF: <a href={`/api/files/${c.pdf.id}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{c.pdf.page_count ?? "?"} páginas</a></>}
              {c.file.page_count ? ` · ${c.file.page_count} páginas` : ""}
              {c.file.media_duration_s ? ` · ${Math.round(c.file.media_duration_s / 60)} min` : ""}
            </p>
          )}
          {c?.type === "link" && <p className="text-xs text-slate-600">Enlace: <a href={c.url!} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{c.url}</a></p>}
          {conv === "failed" && c?.file?.conversion_error && <p className="text-xs text-red-600">{c.file.conversion_error}</p>}

          {!locked && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-slate-600">Se completa cuando…
                <select className="input mt-1" defaultValue={l.completion_rule}
                  onChange={(e) => run(() => updateLesson(l.id, { completion_rule: e.target.value as LessonRow["completion_rule"] as never }))}>
                  {Object.entries(RULE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {l.completion_rule === "min_time" && (
                <label className="text-xs text-slate-600">Minutos mínimos
                  <input type="number" min={1} max={600} className="input mt-1" defaultValue={Math.round((l.min_seconds ?? 60) / 60)}
                    onBlur={(e) => run(() => updateLesson(l.id, { min_seconds: Math.max(1, Number(e.target.value)) * 60 }))} />
                </label>
              )}
              {l.completion_rule === "video_percent" && (
                <label className="text-xs text-slate-600">% del video que debe ver
                  <input type="number" min={10} max={100} className="input mt-1" defaultValue={l.min_video_pct}
                    onBlur={(e) => run(() => updateLesson(l.id, { min_video_pct: Number(e.target.value) }))} />
                </label>
              )}
              <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-600">
                <input type="checkbox" className="size-4" defaultChecked={l.is_required} onChange={(e) => run(() => updateLesson(l.id, { is_required: e.target.checked }))} /> Obligatoria
              </label>
            </div>
          )}

          {needsPdf && !locked && conv !== "processing" && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <AlertTriangle className="size-4 text-amber-500" />
              <span className="text-slate-600">Para verla en pantalla, adjunta la versión en PDF (en PowerPoint: Archivo → Guardar como → PDF).</span>
              <button className="btn-secondary py-1 text-xs" onClick={() => pdfInput.current?.click()}>Subir PDF</button>
              <input ref={pdfInput} type="file" accept=".pdf" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (f) await uploadOne(f, async (fileId) => { const r = await attachPdf(c!.id, fileId); run(async () => r); return r.ok ? null : r.error.message; });
              }} />
            </div>
          )}

          {c?.type === "text" && <TextEditor contentId={c.id} html={c.body_html ?? ""} readOnly={locked} />}
          {locked && <p className="flex items-center gap-1 text-xs text-slate-400"><Lock className="size-3" /> Versión publicada: solo lectura.</p>}
        </div>
      )}
    </li>
  );
}

function QuickAdd({ kind, onSave, onCancel }: { kind: "text" | "link"; onSave: (title: string, url?: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("https://");
  return (
    <form className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (title.trim()) onSave(title, url); }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "text" ? "Título de la lección" : "Título del enlace"} className="input" aria-label="Título" />
      {kind === "link" && <input value={url} onChange={(e) => setUrl(e.target.value)} className="input" aria-label="Dirección" />}
      <div className="flex gap-2"><button className="btn-primary">Agregar</button><button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function AddModule({ onAdd, pending }: { onAdd: (t: string) => void; pending: boolean }) {
  const [title, setTitle] = useState("");
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { onAdd(title); setTitle(""); } }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del nuevo módulo" className="input max-w-sm" aria-label="Nombre del nuevo módulo" />
      <button className="btn-secondary" disabled={pending || !title.trim()}><Plus className="size-4" /> Agregar módulo</button>
    </form>
  );
}

function UploadList({ items, onClear }: { items: UploadItem[]; onClear: () => void }) {
  const busy = items.some((i) => ["hashing", "uploading", "verifying"].includes(i.status));
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">{busy ? "Subiendo archivos…" : "Archivos subidos"}</p>
        {!busy && <button className="text-xs text-brand-700 hover:underline" onClick={onClear}>Limpiar</button>}
      </div>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.key} className="text-sm">
            <div className="flex items-center gap-2">
              {i.status === "error" ? <XCircle className="size-4 text-red-500" /> : i.status === "done" || i.status === "reused" ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Loader2 className="size-4 animate-spin text-brand-600" />}
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{fmtBytes(i.size)}</span>
            </div>
            {i.status === "uploading" && (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-600 transition-all" style={{ width: `${i.progress}%` }} /></div>
            )}
            {(i.message || i.status === "verifying" || i.status === "hashing") && (
              <p className={clsx("mt-0.5 text-xs", i.status === "error" ? "text-red-600" : "text-slate-500")}>
                {i.message ?? (i.status === "verifying" ? "Verificando el archivo…" : "Preparando…")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
