"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { Building2, Loader2, Users, X } from "lucide-react";
import type { OrgOptions } from "@/features/org/queries";
import { searchPeople } from "@/features/users/actions";
import { Alert, Card, Field } from "@/components/ui";
import { createAssignment, previewAssignment, type AssignmentInput } from "../actions";

type Person = { id: string; full_name: string; employee_number: string | null };

/** Asignar un curso (§17): a personas concretas o por empresa/sucursal/departamento/puesto, con fechas. */
export function AssignmentWizard({ courses, org, initialCourse }: {
  courses: { id: string; code: string; title: string; status: string }[]; org: OrgOptions; initialCourse?: string;
}) {
  const [course, setCourse] = useState(initialCourse ?? "");
  const [mode, setMode] = useState<"rule" | "direct">("rule");
  const [crit, setCrit] = useState({ company_id: "", branch_id: "", department_id: "", position_id: "" });
  const [future, setFuture] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [dueMode, setDueMode] = useState<"none" | "date" | "days">("days");
  const [dueDate, setDueDate] = useState("");
  const [dueDays, setDueDays] = useState(15);
  const [requirement, setRequirement] = useState("");
  const [late, setLate] = useState(true);
  const [preview, setPreview] = useState<{ matching: number; already: number; new: number } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const by = <T extends { company_id: string }>(l: T[]) => (crit.company_id ? l.filter((x) => x.company_id === crit.company_id) : l);
  const input = (): AssignmentInput => ({
    course_id: course, mode,
    user_ids: mode === "direct" ? people.map((p) => p.id) : undefined,
    ...(mode === "rule" ? Object.fromEntries(Object.entries(crit).map(([k, v]) => [k, v || null])) : {}),
    include_future_users: mode === "rule" && future,
    requirement: (requirement || null) as AssignmentInput["requirement"],
    due_date: dueMode === "date" && dueDate ? dueDate : null,
    due_in_days: dueMode === "days" ? dueDays : null,
    allow_late_access: late,
  });
  const setC = (k: keyof typeof crit, v: string) => { setCrit((c) => ({ ...c, [k]: v, ...(k === "company_id" ? { branch_id: "", department_id: "", position_id: "" } : {}) })); setPreview(null); };
  const ready = course && (mode === "direct" ? people.length > 0 : Object.values(crit).some(Boolean)) && (dueMode !== "date" || dueDate);

  return (
    <div className="space-y-5">
      {error && <Alert kind="error">{error}</Alert>}
      <Card title="1. ¿Qué curso?">
        <select className="input" value={course} onChange={(e) => { setCourse(e.target.value); setPreview(null); }} aria-label="Curso">
          <option value="">Elige un curso…</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.code}{c.status !== "published" ? " (sin publicar)" : ""}</option>)}
        </select>
      </Card>

      <Card title="2. ¿A quién?">
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {([["rule", Building2, "Por área o puesto", "Empresa, sucursal, departamento y/o puesto. Puede incluir a quienes entren después."],
             ["direct", Users, "Personas específicas", "Busca y elige a cada persona."]] as const).map(([k, Icon, t, d]) => (
            <button key={k} type="button" onClick={() => { setMode(k); setPreview(null); }} aria-pressed={mode === k}
              className={clsx("rounded-lg border p-3 text-left", mode === k ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20" : "border-slate-200 hover:border-slate-300")}>
              <span className="flex items-center gap-2 text-sm font-medium text-slate-800"><Icon className="size-4" /> {t}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{d}</span>
            </button>
          ))}
        </div>
        {mode === "rule" ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {([["company_id", "Empresa", org.companies.map((c) => [c.id, c.name])], ["branch_id", "Sucursal", by(org.branches).map((b) => [b.id, b.name])],
                 ["department_id", "Departamento", by(org.departments).map((d) => [d.id, d.name])], ["position_id", "Puesto", by(org.positions).map((p) => [p.id, p.name])]] as const).map(([k, l, opts]) => (
                <Field key={k} label={l} htmlFor={`c-${k}`}>
                  <select id={`c-${k}`} className="input" value={crit[k]} onChange={(e) => setC(k, e.target.value)}>
                    <option value="">Todos</option>
                    {(opts as unknown as [string, string][]).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5 size-4" checked={future} onChange={(e) => setFuture(e.target.checked)} />
              <span>También a quienes entren o cambien a esta área después<span className="block text-xs text-slate-500">Ejemplo: todo nuevo Operador de TMC recibirá el curso automáticamente al darlo de alta.</span></span>
            </label>
          </div>
        ) : <PeoplePicker people={people} setPeople={(p) => { setPeople(p); setPreview(null); }} />}
      </Card>

      <Card title="3. Fechas">
        <div className="grid gap-2 sm:grid-cols-3">
          {([["days", "Días después de asignarse"], ["date", "Una fecha fija"], ["none", "Sin fecha límite"]] as const).map(([k, l]) => (
            <label key={k} className={clsx("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm", dueMode === k ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
              <input type="radio" name="due" checked={dueMode === k} onChange={() => setDueMode(k)} /> {l}
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {dueMode === "days" && <Field label="Días para terminarlo" htmlFor="due-days" hint="Cuenta desde el día que a cada persona se le asigna (útil para nuevos ingresos)."><input id="due-days" type="number" min={1} max={3650} className="input" value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} /></Field>}
          {dueMode === "date" && <Field label="Fecha límite" htmlFor="due-date"><input id="due-date" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
          <Field label="Tipo" htmlFor="req"><select id="req" className="input" value={requirement} onChange={(e) => setRequirement(e.target.value)}>
            <option value="">Como está definido en el curso</option><option value="mandatory">Obligatorio</option><option value="recommended">Recomendado</option><option value="optional">Opcional</option></select></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700"><input type="checkbox" className="size-4" checked={late} onChange={(e) => setLate(e.target.checked)} /> Puede terminarlo aunque esté vencido</label>
        </div>
      </Card>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600" aria-live="polite">
          {preview ? <>Se asignará a <strong>{preview.new}</strong> persona{preview.new === 1 ? "" : "s"}{preview.already ? ` (${preview.already} ya lo tienen)` : ""}.</>
            : mode === "direct" ? `${people.length} persona${people.length === 1 ? "" : "s"} elegida${people.length === 1 ? "" : "s"}.` : "Revisa a cuántas personas llegará antes de asignar."}
        </p>
        <div className="flex gap-2">
          {mode === "rule" && <button className="btn-secondary" disabled={!ready || pending} onClick={() => start(async () => {
            const r = await previewAssignment(input());
            if (r.ok) { setPreview(r.data!); setError(null); } else setError(r.error.message);
          })}>¿A cuántas personas?</button>}
          <button className="btn-primary" disabled={!ready || pending || (mode === "rule" && !preview)} onClick={() => start(async () => {
            const r = await createAssignment(input());
            if (r && !r.ok) setError(r.error.message);
          })}>{pending && <Loader2 className="size-4 animate-spin" />} Asignar</button>
        </div>
      </div>
    </div>
  );
}

function PeoplePicker({ people, setPeople }: { people: Person[]; setPeople: (p: Person[]) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return;
    timer.current = setTimeout(() => start(async () => setResults(await searchPeople(q))), 250);
  }, [q]);
  return (
    <div className="space-y-3">
      <div className="relative">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca por nombre o número de empleado…" aria-label="Buscar personas" />
        {q.trim().length >= 2 && (
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {pending && <li className="px-3 py-2 text-sm text-slate-500">Buscando…</li>}
            {!pending && results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Sin resultados</li>}
            {results.map((r) => (
              <li key={r.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" disabled={people.some((p) => p.id === r.id)}
                onClick={() => { setPeople([...people, r]); setQ(""); setResults([]); }}>{r.full_name} {r.employee_number && <span className="text-slate-400">· {r.employee_number}</span>}</button></li>
            ))}
          </ul>
        )}
      </div>
      {people.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pr-1 pl-3 text-sm text-brand-800">
              {p.full_name}<button type="button" className="rounded-full p-0.5 hover:bg-brand-100" onClick={() => setPeople(people.filter((x) => x.id !== p.id))} aria-label={`Quitar a ${p.full_name}`}><X className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
