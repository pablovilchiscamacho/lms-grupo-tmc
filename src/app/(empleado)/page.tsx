import { BookOpen, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { Alert, Card, EmptyState, Stat } from "@/components/ui";

export default async function EmployeeHome({ searchParams }: PageProps<"/">) {
  const ctx = await requireUser();
  const sp = await searchParams;
  return (
    <div className="space-y-6">
      {sp.contrasena === "actualizada" && <Alert kind="success">Tu contraseña se actualizó correctamente.</Alert>}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Hola, {ctx.profile.first_name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {[ctx.profile.position?.name, ctx.profile.department?.name, ctx.profile.company.name].filter(Boolean).join(" · ")}
        </p>
      </div>

      <section aria-label="Mi desempeño" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Mi progreso" value="0%" hint="Cumplimiento general" />
        <Stat label="Pendientes" value={0} />
        <Stat label="Aprobados" value={0} tone="green" />
        <Stat label="Promedio" value="—" />
      </section>

      <Card title="Cursos pendientes">
        <EmptyState icon={<BookOpen className="size-8" />} title="Aún no tienes cursos asignados">
          Cuando te asignen un curso aparecerá aquí con su fecha límite y tu avance.
        </EmptyState>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Próximos a vencer">
          <EmptyState icon={<Clock className="size-7" />} title="Nada por vencer" />
        </Card>
        <Card title="Completados recientemente">
          <EmptyState icon={<CheckCircle2 className="size-7" />} title="Todavía no completas cursos" />
        </Card>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-400"><TrendingUp className="size-3.5" /> Los cursos y exámenes se habilitan en las siguientes fases del proyecto.</p>
    </div>
  );
}
