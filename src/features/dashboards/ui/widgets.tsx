import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { lightOf, type TrendRow } from "../queries";

const LIGHT = {
  green: { dot: "bg-emerald-500", text: "text-emerald-700", bar: "bg-emerald-500", label: "En cumplimiento" },
  amber: { dot: "bg-amber-400", text: "text-amber-700", bar: "bg-amber-400", label: "En riesgo" },
  red: { dot: "bg-red-500", text: "text-red-700", bar: "bg-red-500", label: "Crítico" },
} as const;

const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`);
export { pctText };

/** Porcentaje de cumplimiento con su semáforo (verde ≥ 90, amarillo 70–89, rojo < 70). */
export function Compliance({ value, size = "sm" }: { value: number | null | undefined; size?: "sm" | "lg" }) {
  const l = lightOf(value);
  if (!l) return <span className="text-slate-400">—</span>;
  return (
    <span className={clsx("relative inline-flex items-center gap-1.5 font-medium tabular-nums", LIGHT[l].text, size === "lg" && "text-2xl font-semibold")}>
      <span className={clsx("inline-block rounded-full", LIGHT[l].dot, size === "lg" ? "size-3" : "size-2")} aria-hidden />
      {pctText(value)}
      <span className="sr-only"> ({LIGHT[l].label})</span>
    </span>
  );
}

/** Barra de porcentaje coloreada según el semáforo. */
export function PctBar({ value, tone }: { value: number | null | undefined; tone?: "green" | "amber" | "red" | "brand" }) {
  const v = Math.max(0, Math.min(100, Number(value ?? 0)));
  const t = tone ?? lightOf(value) ?? "green";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
      <div className={clsx("h-full rounded-full", t === "brand" ? "bg-brand-600" : LIGHT[t].bar)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Lista de barras horizontales (ranking). */
export function BarList({ rows, empty = "Sin datos todavía" }: {
  rows: { key: string; label: ReactNode; value: number | null; meta?: ReactNode; href?: string; tone?: "green" | "amber" | "red" | "brand" }[];
  empty?: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-800">{r.label}</span>
              <span className="shrink-0 tabular-nums text-slate-600">{r.tone ? pctText(r.value) : <Compliance value={r.value} />}</span>
            </div>
            <PctBar value={r.value} tone={r.tone} />
            {r.meta && <p className="mt-1 text-xs text-slate-500">{r.meta}</p>}
          </>
        );
        return <li key={r.key}>{r.href ? <Link href={r.href} className="block rounded-md hover:bg-slate-50">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}

/** Elemento de «Requiere atención». */
export function AttentionItem({ href, text, tone }: { href: string; text: ReactNode; tone: "red" | "amber" | "green" }) {
  const Icon = tone === "green" ? CheckCircle2 : tone === "red" ? CircleAlert : AlertTriangle;
  return (
    <li>
      <Link href={href} className="flex items-center gap-2.5 py-2.5 text-sm text-slate-700 hover:text-slate-900">
        <Icon className={clsx("size-4 shrink-0", tone === "red" ? "text-red-500" : tone === "amber" ? "text-amber-500" : "text-emerald-600")} aria-hidden />
        <span className="flex-1">{text}</span>
        <ChevronRight className="size-4 text-slate-400" aria-hidden />
      </Link>
    </li>
  );
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthLabel = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y.slice(2)}`; };

/** Evolución mensual del cumplimiento (foto del último día de cada mes). */
export function TrendChart({ rows }: { rows: TrendRow[] }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">La evolución se construye con una foto diaria; aparecerá conforme pasen los días.</p>;
  const W = 640, H = 220, L = 36, R = 16, T = 16, B = 28;
  const n = rows.length;
  const x = (i: number) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + ((100 - v) * (H - T - B)) / 100;
  const pts = rows.map((r, i) => [x(i), y(Number(r.compliance ?? 0))] as const);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Evolución mensual del cumplimiento">
        {[0, 70, 90, 100].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="currentColor" className={g === 70 || g === 90 ? "text-slate-300" : "text-slate-200"} strokeDasharray={g === 70 || g === 90 ? "4 4" : undefined} />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" className="fill-slate-400 text-[11px]">{g}%</text>
          </g>
        ))}
        {n > 1 && <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth={2.5} className="text-brand-600" strokeLinejoin="round" />}
        {pts.map(([px, py], i) => (
          <g key={rows[i].month}>
            <circle cx={px} cy={py} r={4} className="fill-brand-600" />
            <text x={px} y={py - 9} textAnchor="middle" className="fill-slate-700 text-[11px] font-medium">{pctText(rows[i].compliance)}</text>
            <text x={px} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">{monthLabel(rows[i].month)}</text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 text-xs text-slate-500">Líneas punteadas: 70 % y 90 % (umbrales del semáforo).</figcaption>
    </figure>
  );
}

/** Grupo de indicadores pequeños (etiqueta / valor). */
export function KpiGroup({ title, items }: { title: string; items: [string, ReactNode][] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      <dl className="space-y-1.5">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-slate-600">{k}</dt>
            <dd className="font-medium tabular-nums text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
