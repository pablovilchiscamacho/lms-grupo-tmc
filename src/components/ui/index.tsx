import clsx from "clsx";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import Image from "next/image";
import logo from "@/assets/grupo-tmc.png";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-brand-50 text-brand-700 ring-brand-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone])}>
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = { active: "green", inactive: "slate", suspended: "amber", deleted: "red" };

const ALERT = {
  info: { cls: "border-brand-200 bg-brand-50 text-brand-900", Icon: Info },
  success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CheckCircle2 },
  warning: { cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
  error: { cls: "border-red-200 bg-red-50 text-red-900", Icon: XCircle },
};
export function Alert({ kind = "info", title, children }: { kind?: keyof typeof ALERT; title?: string; children?: ReactNode }) {
  const { cls, Icon } = ALERT[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={clsx("flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm", cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={clsx(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-800">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tabular-nums",
        tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "green" ? "text-emerald-600" : "text-slate-900")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Field({ label, htmlFor, error, hint, children, required }: {
  label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required && <span className="text-red-500" aria-hidden> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {ini}
    </span>
  );
}

/** Marca provisional hasta recibir el logo oficial del grupo. */
/** Logo de Grupo TMC con la etiqueta «Capacitación». */
export function BrandMark({ className, size = "md", label = true }: { className?: string; size?: "md" | "lg"; label?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-3", className)}>
      <Image src={logo} alt="Grupo TMC" priority className={size === "lg" ? "h-12 w-auto" : "h-8 w-auto"} />
      {label && <span className="border-l border-current/20 pl-3 text-xs font-medium tracking-wide text-current/70">Capacitación</span>}
    </span>
  );
}
