"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Clock, CloudOff, Loader2, Send } from "lucide-react";
import { Alert, Badge } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { reportFocusLost, saveAnswer, startAttempt, submitAttempt, type AttemptPayload, type Snapshot } from "../actions";
import type { MyExam } from "../queries";

type Resp = Record<string, unknown> | null;

function getToken(examId: string) {
  const k = `exam-token-${examId}`;
  try {
    const have = sessionStorage.getItem(k);
    if (have) return have;
  } catch { /* sin almacenamiento: token por carga */ }
  const t = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  try { sessionStorage.setItem(k, t); } catch { /* ignorar */ }
  return t;
}

/** Pantalla previa (§42): nombre, preguntas, tiempo, intentos, mínimo y advertencia. */
export function ExamIntro({ exam, enrollmentId }: { exam: MyExam; enrollmentId: string }) {
  const [started, setStarted] = useState(!!exam.open_attempt);
  const remaining = exam.max_attempts == null ? null : Math.max(exam.max_attempts - exam.used, 0);
  const blocked = exam.locked ? "Primero termina las lecciones del curso." : !exam.is_active ? "El examen está pausado por el momento."
    : exam.passed ? "Ya aprobaste este examen." : exam.pending ? "Tu intento anterior está en revisión. Te avisaremos cuando lo califiquen."
      : !exam.can_retry ? "Ya usaste todos tus intentos. Habla con tu administrador si necesitas otro." : null;
  if (started) return <ExamRunner exam={exam} enrollmentId={enrollmentId} />;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={`/cursos/${enrollmentId}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="size-4" /> Volver al curso</Link>
      <div className="card p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{exam.title}</h1>
        {exam.instructions && <p className="mt-2 text-sm whitespace-pre-wrap text-slate-600">{exam.instructions}</p>}
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Info label="Preguntas" value={exam.question_count} />
          <Info label="Tiempo" value={exam.time_limit_minutes ? `${exam.time_limit_minutes} min` : "Sin límite"} />
          <Info label="Intentos restantes" value={remaining == null ? "Ilimitados" : remaining} />
          <Info label="Para aprobar" value={`${Number(exam.passing_score)}%`} />
        </dl>
        {exam.time_limit_minutes && !blocked && (
          <div className="mt-5"><Alert kind="warning" title="Una vez iniciado el examen el tiempo continuará corriendo.">Aunque cierres la ventana o pierdas la conexión, el reloj sigue. Tus respuestas se guardan solas.</Alert></div>
        )}
        {blocked ? <div className="mt-5"><Alert kind={exam.passed ? "success" : "info"}>{blocked}</Alert></div> : (
          <button className="btn-primary mt-6 w-full py-3 text-base" onClick={() => setStarted(true)}>Comenzar examen</button>
        )}
      </div>
      {exam.attempts.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 text-sm font-medium text-slate-800">Tus intentos</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {exam.attempts.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span>Intento {a.number}</span>
                <span className="flex items-center gap-2">
                  {a.status === "pending_review" ? <Badge tone="amber">En revisión</Badge> : a.score_pct != null ? <Badge tone={a.passed ? "green" : "red"}>{Number(a.score_pct)}%</Badge> : <Badge>Entregado</Badge>}
                  {a.status !== "in_progress" && <Link href={`/cursos/${enrollmentId}/examen/${exam.id}/resultado/${a.id}`} className="text-xs text-brand-700 hover:underline">Ver</Link>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="text-lg font-semibold text-slate-900 tabular-nums">{value}</dd></div>;
}

type SaveState = "idle" | "saving" | "saved" | "offline";

function ExamRunner({ exam, enrollmentId }: { exam: MyExam; enrollmentId: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<AttemptPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, Resp>>({});
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [left, setLeft] = useState<number | null>(null);
  const token = useRef("");
  const offset = useRef(0);
  const dirty = useRef<Map<string, Resp>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const finished = useRef(false);
  const flushRef = useRef<(qid: string) => void>(() => undefined);
  const resultUrl = (id: string) => `/cursos/${enrollmentId}/examen/${exam.id}/resultado/${id}`;

  const begin = useCallback(async () => {
    token.current = getToken(exam.id);
    const r = await startAttempt(exam.id, token.current);
    if (!r.ok) { setError(r.error.message); return; }
    const a = r.data!;
    offset.current = new Date(a.server_now).getTime() - Date.now();
    const initial: Record<string, Resp> = {};
    for (const q of a.questions) initial[q.id] = q.response;
    // Respaldo local por si la última respuesta no alcanzó a llegar al servidor.
    try {
      const backup = JSON.parse(localStorage.getItem(`exam-backup-${a.attempt_id}`) ?? "{}") as Record<string, Resp>;
      for (const [k, v] of Object.entries(backup)) if (k in initial) { initial[k] = v; dirty.current.set(k, v); }
    } catch { /* sin respaldo */ }
    setAnswers(initial);
    setAttempt(a);
    setConflict(false);
  }, [exam.id]);

  // Arranca o reanuda al montar (la llamada al servidor es asíncrona; el estado se fija al responder).
  useEffect(() => { void Promise.resolve().then(begin); }, [begin]);

  const finish = useCallback(async (attemptId: string) => {
    if (finished.current) return;
    finished.current = true;
    try { localStorage.removeItem(`exam-backup-${attemptId}`); } catch { /* ignorar */ }
    router.push(resultUrl(attemptId));
    router.refresh();
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async (qid: string) => {
    if (!attempt || !dirty.current.has(qid)) return;
    const value = dirty.current.get(qid) ?? null;
    setSave("saving");
    const r = await saveAnswer(attempt.attempt_id, qid, value, token.current);
    if (r.ok) {
      if (r.data?.closed) { await finish(attempt.attempt_id); return; }
      if (dirty.current.get(qid) === value) dirty.current.delete(qid);
      setSave(dirty.current.size ? "saving" : "saved");
    } else if (r.error.code === "SESSION_CONFLICT") {
      setConflict(true);
    } else if (r.error.code === "UNKNOWN") {
      setSave("offline");
      timers.current.set(qid, setTimeout(() => flushRef.current(qid), 5000));
    } else setError(r.error.message);
  }, [attempt, finish]);

  useEffect(() => { flushRef.current = flush; }, [flush]);

  const answer = (qid: string, v: Resp) => {
    setAnswers((a) => ({ ...a, [qid]: v }));
    dirty.current.set(qid, v);
    try { localStorage.setItem(`exam-backup-${attempt!.attempt_id}`, JSON.stringify(Object.fromEntries(dirty.current))); } catch { /* ignorar */ }
    clearTimeout(timers.current.get(qid));
    timers.current.set(qid, setTimeout(() => flush(qid), 800));
    setSave("saving");
  };

  const flushAll = useCallback(async () => { for (const k of [...dirty.current.keys()]) await flush(k); }, [flush]);

  const submit = useCallback(() => startSubmit(async () => {
    if (!attempt) return;
    await flushAll();
    const r = await submitAttempt(attempt.attempt_id, token.current);
    if (!r.ok && r.error.code === "SESSION_CONFLICT") { setConflict(true); return; }
    await finish(attempt.attempt_id);
  }), [attempt, flushAll, finish]);

  // Reloj: usa la hora límite del servidor; al llegar a cero entrega solo.
  useEffect(() => {
    if (!attempt?.deadline_at) return;
    const deadline = new Date(attempt.deadline_at).getTime();
    const tick = () => {
      const ms = deadline - (Date.now() + offset.current);
      setLeft(Math.max(0, Math.floor(ms / 1000)));
      if (ms <= 0) submit();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [attempt, submit]);

  useEffect(() => {
    if (!attempt) return;
    const onVis = () => { if (document.visibilityState === "hidden") { flushAll(); reportFocusLost(attempt.attempt_id); } };
    const onOnline = () => flushAll();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("online", onOnline); };
  }, [attempt, flushAll]);

  if (error) return <div className="mx-auto max-w-xl space-y-3"><Alert kind="error">{error}</Alert><Link href={`/cursos/${enrollmentId}`} className="btn-secondary">Volver al curso</Link></div>;
  if (!attempt) return <p className="flex items-center justify-center gap-2 py-20 text-slate-500"><Loader2 className="size-5 animate-spin" /> Preparando tu examen…</p>;

  const qs = attempt.questions;
  const q = qs[idx];
  const isAnswered = (v: Resp) => v != null && Object.values(v).some((x) => (Array.isArray(x) ? x.length > 0 : typeof x === "object" && x !== null ? Object.keys(x).length > 0 : x !== "" && x != null));
  const answeredCount = qs.filter((x) => isAnswered(answers[x.id])).length;
  const mm = left == null ? null : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
        <p className="text-sm font-medium text-slate-800">{attempt.title} · intento {attempt.attempt_number}</p>
        <div className="flex items-center gap-3 text-sm">
          <span className={clsx("flex items-center gap-1 text-xs", save === "offline" ? "text-red-600" : "text-slate-500")} aria-live="polite">
            {save === "saving" && <><Loader2 className="size-3.5 animate-spin" /> Guardando…</>}
            {save === "saved" && <><CheckCircle2 className="size-3.5 text-emerald-600" /> Guardado</>}
            {save === "offline" && <><CloudOff className="size-3.5" /> Sin conexión, reintentando</>}
          </span>
          {mm && <span className={clsx("flex items-center gap-1 rounded-md px-2 py-1 font-semibold tabular-nums", left! <= 60 ? "bg-red-100 text-red-700" : left! <= 300 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-800")} role="timer" aria-label={`Tiempo restante ${mm}`}><Clock className="size-4" /> {mm}</span>}
        </div>
      </div>
      {attempt.resumed && <Alert kind="info">Retomaste tu examen donde lo dejaste.</Alert>}

      <nav aria-label="Preguntas" className="flex flex-wrap gap-1.5">
        {qs.map((x, i) => (
          <button key={x.id} onClick={() => setIdx(i)} aria-current={i === idx ? "step" : undefined}
            className={clsx("size-8 rounded-md text-xs font-semibold tabular-nums", i === idx ? "bg-brand-800 text-white" : isAnswered(answers[x.id]) ? "bg-brand-100 text-brand-800" : "border border-slate-300 bg-white text-slate-600")}>
            {i + 1}
          </button>
        ))}
      </nav>
      <p className="text-xs text-slate-500">{answeredCount} de {qs.length} respondidas</p>

      <article className="card p-5">
        <p className="mb-1 text-xs font-medium text-slate-500">Pregunta {idx + 1} de {qs.length}{q.snapshot.points > 0 ? ` · ${q.snapshot.points} pts` : ""}</p>
        <h2 className="text-base font-medium whitespace-pre-wrap text-slate-900">{q.snapshot.prompt}</h2>
        <div className="mt-4"><AnswerInput key={q.id} snap={q.snapshot} value={answers[q.id] ?? null} onChange={(v) => answer(q.id, v)} /></div>
      </article>

      <div className="flex items-center justify-between gap-2">
        <button className="btn-secondary" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronLeft className="size-4" /> Anterior</button>
        {idx < qs.length - 1 ? <button className="btn-primary" onClick={() => { flush(q.id); setIdx(idx + 1); }}>Siguiente <ChevronRight className="size-4" /></button>
          : <button className="btn-primary" onClick={() => setConfirmOpen(true)}><Send className="size-4" /> Terminar y enviar</button>}
      </div>
      <div className="text-center"><button className="text-xs text-brand-700 hover:underline" onClick={() => setConfirmOpen(true)}>Enviar examen</button></div>

      <Modal open={confirmOpen} onOpenChange={setConfirmOpen} title="¿Enviar el examen?" description="Después de enviarlo ya no podrás cambiar tus respuestas.">
        {answeredCount < qs.length && <div className="mb-3"><Alert kind="warning">Te faltan {qs.length - answeredCount} pregunta{qs.length - answeredCount === 1 ? "" : "s"} por responder.</Alert></div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmOpen(false)}>Seguir revisando</button>
          <button className="btn-primary" disabled={submitting} onClick={submit}>{submitting && <Loader2 className="size-4 animate-spin" />} Enviar</button>
        </div>
      </Modal>
      <Modal open={conflict} onOpenChange={() => undefined} title="El examen se abrió en otro lugar" description="Solo puedes responder desde un dispositivo o pestaña a la vez.">
        <div className="flex items-start gap-2 text-sm text-slate-600"><AlertTriangle className="mt-0.5 size-4 text-amber-500" /> Si continúas aquí, la otra pestaña o dispositivo dejará de poder guardar. El tiempo no se detiene.</div>
        <div className="mt-4 flex justify-end"><button className="btn-primary" onClick={() => { try { sessionStorage.removeItem(`exam-token-${exam.id}`); } catch { /* ignorar */ } begin(); }}>Continuar aquí</button></div>
      </Modal>
    </div>
  );
}

function AnswerInput({ snap, value, onChange }: { snap: Snapshot; value: Resp; onChange: (v: Resp) => void }) {
  const opt = "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition";
  const on = "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30";
  const off = "border-slate-200 hover:border-slate-300";
  switch (snap.type) {
    case "single_choice":
    case "true_false":
      return (
        <fieldset className="space-y-2">
          <legend className="sr-only">Elige una respuesta</legend>
          {snap.options.map((o) => (
            <label key={o.id} className={clsx(opt, value?.option_id === o.id ? on : off)}>
              <input type="radio" name="resp" className="mt-0.5" checked={value?.option_id === o.id} onChange={() => onChange({ option_id: o.id })} /> {o.text}
            </label>
          ))}
        </fieldset>
      );
    case "multiple_choice": {
      const sel = new Set((value?.option_ids as string[]) ?? []);
      return (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs text-slate-500">Puede haber varias respuestas correctas.</legend>
          {snap.options.map((o) => (
            <label key={o.id} className={clsx(opt, sel.has(o.id) ? on : off)}>
              <input type="checkbox" className="mt-0.5" checked={sel.has(o.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(o.id); else n.delete(o.id); onChange({ option_ids: [...n] }); }} /> {o.text}
            </label>
          ))}
        </fieldset>
      );
    }
    case "short_text":
      return <input className="input" value={(value?.text as string) ?? ""} onChange={(e) => onChange({ text: e.target.value.slice(0, 500) })} placeholder="Escribe tu respuesta" aria-label="Respuesta" />;
    case "open_text": {
      const max = snap.max_chars ?? 4000;
      const text = (value?.text as string) ?? "";
      return (
        <div>
          <textarea rows={7} className="input" value={text} onChange={(e) => onChange({ text: e.target.value.slice(0, max) })} placeholder="Escribe tu respuesta" aria-label="Respuesta" />
          <p className="mt-1 text-right text-xs text-slate-400">{text.length} / {max}</p>
        </div>
      );
    }
    case "ordering": {
      const order = (value?.order as string[]) ?? snap.options.map((o) => o.id);
      const byId = new Map(snap.options.map((o) => [o.id, o.text]));
      const move = (i: number, d: -1 | 1) => { const n = [...order]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange({ order: n }); };
      return (
        <ol className="space-y-2">
          <p className="text-xs text-slate-500">Usa las flechas para acomodarlos en el orden correcto.</p>
          {!value && <button type="button" className="btn-secondary py-1 text-xs" onClick={() => onChange({ order })}>Este orden ya es el correcto</button>}
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
              <span className="w-5 text-xs font-semibold text-slate-400">{i + 1}</span>
              <span className="flex-1">{byId.get(id)}</span>
              <button type="button" className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp className="size-4" /></button>
              <button type="button" className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown className="size-4" /></button>
            </li>
          ))}
        </ol>
      );
    }
    case "matching": {
      const pairs = (value?.pairs as Record<string, string>) ?? {};
      return (
        <div className="space-y-2">
          {snap.options.map((o) => (
            <div key={o.id} className="grid gap-2 rounded-lg border border-slate-200 p-2.5 sm:grid-cols-2 sm:items-center">
              <span className="text-sm font-medium text-slate-800">{o.text}</span>
              <select className="input" value={pairs[o.id] ?? ""} aria-label={`Pareja de ${o.text}`} onChange={(e) => { const n = { ...pairs }; if (e.target.value) n[o.id] = e.target.value; else delete n[o.id]; onChange({ pairs: n }); }}>
                <option value="">Elige…</option>
                {snap.targets!.map((t) => <option key={t.id} value={t.id}>{t.text}</option>)}
              </select>
            </div>
          ))}
        </div>
      );
    }
    case "scale": {
      const s = snap.scale!;
      const nums = Array.from({ length: s.max - s.min + 1 }, (_, i) => s.min + i);
      return (
        <div>
          <div className="flex flex-wrap gap-2">
            {nums.map((n) => <button key={n} type="button" onClick={() => onChange({ value: n })} aria-pressed={value?.value === n}
              className={clsx("size-11 rounded-lg border text-sm font-semibold", value?.value === n ? "border-brand-600 bg-brand-700 text-white" : "border-slate-300 bg-white hover:bg-slate-50")}>{n}</button>)}
          </div>
          {(s.min_label || s.max_label) && <div className="mt-1 flex justify-between text-xs text-slate-500" style={{ maxWidth: nums.length * 52 }}><span>{s.min_label}</span><span>{s.max_label}</span></div>}
        </div>
      );
    }
  }
}
