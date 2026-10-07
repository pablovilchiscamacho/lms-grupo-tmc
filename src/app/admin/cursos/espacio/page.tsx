import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { getStorageUsage } from "@/features/courses/queries";
import { fmtBytes } from "@/lib/format";
import { Alert, Card, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Espacio usado" };
const KIND: Record<string, string> = { document: "Presentaciones y documentos", video: "Videos", image: "Imágenes", other: "Otros" };

export default async function StoragePage() {
  await requirePermission("courses.read", "/admin/cursos/espacio");
  const u = await getStorageUsage();
  const quota = u.quota_gb * 1024 ** 3;
  const pct = (u.used_bytes / quota) * 100;
  return (
    <>
      <Link href="/admin/cursos" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Cursos</Link>
      <PageHeader title="Espacio usado" description="Lo que ocupan los archivos de todos los cursos en el almacenamiento." />
      {pct >= u.warn_pct && <div className="mb-4"><Alert kind="warning" title={`Llevas ${pct.toFixed(0)} % del espacio`}>Revisa los archivos más pesados (casi siempre son videos) o pide ampliar el plan.</Alert></div>}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Usado" value={fmtBytes(u.used_bytes)} hint={`de ${u.quota_gb} GB (${pct.toFixed(1)} %)`} tone={pct >= u.warn_pct ? "amber" : undefined} />
        <Stat label="Disponible" value={fmtBytes(Math.max(quota - u.used_bytes, 0))} />
        <Stat label="Archivos" value={u.files} />
        <Stat label="Videos" value={fmtBytes(u.by_kind.video ?? 0)} hint="Lo que más espacio ocupa" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Por tipo">
          <ul className="space-y-3">
            {Object.entries(u.by_kind).sort((a, b) => b[1] - a[1]).map(([k, b]) => (
              <li key={k}>
                <div className="flex justify-between text-sm"><span className="text-slate-700">{KIND[k] ?? k}</span><span className="tabular-nums text-slate-500">{fmtBytes(b)}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${(b / Math.max(u.used_bytes, 1)) * 100}%` }} /></div>
              </li>
            ))}
            {Object.keys(u.by_kind).length === 0 && <li className="text-sm text-slate-500">Aún no hay archivos.</li>}
          </ul>
        </Card>
        <Card title="Cursos que más ocupan">
          <ul className="divide-y divide-slate-100">
            {u.by_course.map((c) => (
              <li key={c.course_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/admin/cursos/${c.course_id}`} className="min-w-0 truncate text-slate-800 hover:underline">{c.title} <span className="text-slate-400">· {c.code}</span></Link>
                <span className="shrink-0 tabular-nums text-slate-500">{fmtBytes(c.bytes)}</span>
              </li>
            ))}
            {u.by_course.length === 0 && <li className="py-2 text-sm text-slate-500">Aún no hay archivos.</li>}
          </ul>
        </Card>
        <Card title="Archivos más pesados" className="xl:col-span-2">
          <ul className="divide-y divide-slate-100">
            {u.largest.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-800">{f.name} {f.course && <span className="text-slate-400">· {f.course}</span>}</span>
                <span className="shrink-0 tabular-nums text-slate-500">{fmtBytes(f.bytes)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">Consejo: exporta los videos en 720p; pesan hasta 4 veces menos y se ven bien en pantallas de trabajo y celulares.</p>
        </Card>
      </div>
    </>
  );
}
