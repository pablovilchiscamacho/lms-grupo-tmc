import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { daysLeft, fmtDate, REQUIREMENT_LABEL } from "@/lib/format";
import { Badge } from "@/components/ui";
import type { MyEnrollment } from "../queries";

/** Tarjeta de curso del empleado (§6): nombre, descripción, fecha límite, días restantes, avance, estado y "Continuar". */
export function CourseCard({ e, tz }: { e: MyEnrollment; tz?: string }) {
  const done = e.progress_status === "completed";
  const left = daysLeft(e.due_at);
  const overdue = !done && left !== null && left < 0;
  const soon = !done && left !== null && left >= 0 && left <= 7;
  return (
    <article className={clsx("card flex flex-col p-4", overdue && "border-red-200", soon && "border-amber-200")}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {e.requirement === "mandatory" ? <Badge tone="blue">Obligatorio</Badge> : <Badge>{REQUIREMENT_LABEL[e.requirement]}</Badge>}
        {done ? <Badge tone="green">Completado</Badge> : overdue ? <Badge tone="red">Vencido</Badge> : e.progress_status === "in_progress" ? <Badge tone="blue">En progreso</Badge> : <Badge>Pendiente</Badge>}
      </div>
      <h3 className="font-semibold text-slate-900">{e.course?.title}</h3>
      {e.course?.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{e.course.description}</p>}
      <div className="mt-3 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(e.progress_pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={clsx("h-full", done ? "bg-emerald-500" : "bg-brand-600")} style={{ width: `${e.progress_pct}%` }} />
        </div>
        <span className="text-xs tabular-nums text-slate-600">{Math.round(e.progress_pct)}%</span>
      </div>
      <div className="mt-3 flex flex-1 items-end justify-between gap-2">
        <p className={clsx("flex items-center gap-1 text-xs", overdue ? "text-red-600" : soon ? "text-amber-700" : "text-slate-500")}>
          {done ? <><CheckCircle2 className="size-3.5" /> Terminado el {fmtDate(e.content_completed_at, tz)}</>
            : e.due_at ? (overdue ? <><AlertTriangle className="size-3.5" /> Venció el {fmtDate(e.due_at, tz)}</>
              : <><Clock className="size-3.5" /> {left === 0 ? "Vence hoy" : left === 1 ? "Te queda 1 día" : `Te quedan ${left} días`}</>)
            : "Sin fecha límite"}
        </p>
        <Link href={`/cursos/${e.id}`} className={done ? "btn-secondary py-1.5" : "btn-primary py-1.5"}>{done ? "Repasar" : e.progress_status === "not_started" ? "Empezar" : "Continuar"}</Link>
      </div>
    </article>
  );
}
