import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { enrollmentsFor, examsByVersion, getAssignment } from "@/features/assignments/queries";
import { EnrollmentTable } from "@/features/assignments/ui/enrollment-table";
import { AssignmentToggle } from "@/features/assignments/ui/assignment-toggle";
import { fmtDate, REQUIREMENT_LABEL } from "@/lib/format";
import { Alert, Card, PageHeader, Stat } from "@/components/ui";
import { audienceLabel } from "@/features/assignments/format";

export const metadata: Metadata = { title: "Asignación" };

export default async function AssignmentPage({ params, searchParams }: PageProps<"/admin/asignaciones/[id]">) {
  const { id } = await params;
  const ctx = await requirePermission("assignments.read", `/admin/asignaciones/${id}`);
  const sp = await searchParams;
  const a = await getAssignment(id);
  if (!a) notFound();
  const rows = await enrollmentsFor({ assignment: id });
  const exams = await examsByVersion(rows.map((r) => r.course_version_id ?? ""));
  const active = rows.filter((r) => r.state === "active");
  const done = active.filter((r) => r.result === "passed" || (r.result === "none" && r.progress_status === "completed")).length;
  const overdue = active.filter((r) => r.due_at && new Date(r.due_at) < new Date() && r.progress_status !== "completed").length;
  return (
    <>
      <Link href="/admin/asignaciones" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Asignaciones</Link>
      <PageHeader title={a.course?.title ?? "Asignación"} description={`${audienceLabel(a)} · ${REQUIREMENT_LABEL[a.requirement]} · ${a.due_in_days ? `${a.due_in_days} días para terminarlo` : a.due_at ? `vence el ${fmtDate(a.due_at)}` : "sin fecha límite"}`}
        actions={can(ctx, "assignments.write") ? <AssignmentToggle id={a.id} active={a.is_active} future={a.include_future_users} /> : undefined} />
      {sp.creada && <div className="mb-4"><Alert kind="success">Asignación creada. Cada persona ya ve el curso en «Mis cursos» y recibió un aviso.</Alert></div>}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Personas" value={active.length} />
        <Stat label="Terminaron" value={done} tone="green" hint={active.length ? `${Math.round((done / active.length) * 100)}%` : undefined} />
        <Stat label="Vencidos" value={overdue} tone={overdue ? "amber" : undefined} />
        <Stat label="Automática" value={a.include_future_users ? "Sí" : "No"} hint={a.include_future_users ? "Incluye a quienes entren después" : undefined} />
      </div>
      <Card title="Personas"><EnrollmentTable rows={rows} exams={exams} canAdjust={can(ctx, "enrollments.adjust")} revalidate={`/admin/asignaciones/${id}`} show={{ user: true }} /></Card>
    </>
  );
}
