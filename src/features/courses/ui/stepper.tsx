import Link from "next/link";
import clsx from "clsx";
import { Check } from "lucide-react";

export const STEPS = [
  { key: "datos", label: "Datos" },
  { key: "contenido", label: "Contenido" },
  { key: "examen", label: "Examen" },
  { key: "publicar", label: "Publicar y asignar" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"] | "participantes";

/** Asistente de 4 pasos (§11.3). Sin curso aún, solo el paso 1 está activo. */
export function Stepper({ current, courseId, done = [] }: { current: StepKey; courseId?: string; done?: string[] }) {
  return (
    <nav aria-label="Pasos del curso" className="mb-5 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-2">
        {STEPS.map((s, i) => {
          const active = s.key === current;
          const isDone = done.includes(s.key);
          const content = (
            <span className={clsx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
              active ? "border-brand-600 bg-brand-50 font-medium text-brand-800" : "border-slate-200 bg-white text-slate-600",
              courseId && !active && "hover:border-slate-300")}>
              <span className={clsx("inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                isDone ? "bg-emerald-600 text-white" : active ? "bg-brand-700 text-white" : "bg-slate-200 text-slate-600")}>
                {isDone ? <Check className="size-3" /> : i + 1}
              </span>
              {s.label}
            </span>
          );
          return (
            <li key={s.key} className="flex items-center gap-2">
              {courseId ? <Link href={`/admin/cursos/${courseId}?paso=${s.key}`} aria-current={active ? "step" : undefined}>{content}</Link> : content}
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-slate-300" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
