import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { getCourse, getVersionTree, listParticipants } from "@/features/courses/queries";
import { getOrgOptions } from "@/features/org/queries";
import { getPublishIssues, updateCourse } from "@/features/courses/actions";
import { CourseForm } from "@/features/courses/ui/course-form";
import { ContentBuilder } from "@/features/courses/ui/content-builder";
import { PublishPanel } from "@/features/courses/ui/publish-panel";
import { Stepper, type StepKey } from "@/features/courses/ui/stepper";
import { conversionEnabled } from "@/lib/conversion";
import { getExams, listQuestionCategories } from "@/features/exams/queries";
import { ExamBuilder } from "@/features/exams/ui/exam-builder";
import { COURSE_STATUS, fmtDate, fmtDuration } from "@/lib/format";
import { Badge, Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Curso" };

export default async function CoursePage({ params, searchParams }: PageProps<"/admin/cursos/[id]">) {
  const { id } = await params;
  const ctx = await requirePermission("courses.read", `/admin/cursos/${id}`);
  const sp = await searchParams;
  const course = await getCourse(id);
  if (!course) notFound();
  const step = (["datos", "contenido", "examen", "publicar", "participantes"].includes(String(sp.paso)) ? sp.paso : "contenido") as StepKey;

  const open = course.versions.find((v) => v.status === "draft" || v.status === "review") ?? null;
  const published = course.versions.find((v) => v.status === "published") ?? null;
  const shown = open ?? published ?? course.versions[0];
  const [label, tone] = COURSE_STATUS[course.status] ?? [course.status, "slate"];

  const [exams, categories] = step === "examen" ? await Promise.all([getExams(shown.id), listQuestionCategories()]) : [[], []];
  const [tree, org, issues, participants] = await Promise.all([
    step === "contenido" ? getVersionTree(shown.id) : Promise.resolve([]),
    step === "datos" || step === "publicar" ? getOrgOptions() : Promise.resolve(null),
    step === "publicar" && open ? getPublishIssues(open.id) : Promise.resolve([]),
    step === "participantes" ? listParticipants(course.id) : Promise.resolve([]),
  ]);
  const done = [
    "datos",
    ...(published ? ["contenido", "publicar"] : []),
  ];

  return (
    <>
      <Link href="/admin/cursos" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Cursos</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{course.code}</p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{course.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {published ? `Versión ${published.version_number} publicada el ${fmtDate(published.published_at)}` : "Aún no se publica"}
            {open && published && ` · versión ${open.version_number} en edición`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          <Link href={`?paso=participantes`} className="btn-secondary"><Users className="size-4" /> Participantes</Link>
        </div>
      </div>

      <Stepper current={step} courseId={course.id} done={done} />

      {step === "datos" && org && (
        <Card>
          <CourseForm mode="edit" action={updateCourse.bind(null, course.id)} companies={org.companies} initial={course} />
        </Card>
      )}

      {step === "contenido" && (
        <ContentBuilder courseId={course.id} versionId={shown.id} versionNumber={shown.version_number}
          locked={shown.status !== "draft" || !can(ctx, "courses.update")} modules={tree} conversionEnabled={conversionEnabled()} />
      )}

      {step === "examen" && (
        <ExamBuilder courseId={course.id} courseCode={course.code} versionId={shown.id} exams={exams} categories={categories}
          locked={shown.status !== "draft" || !can(ctx, "exams.write")} />
      )}

      {step === "publicar" && org && (
        <PublishPanel
          courseId={course.id} code={course.code} title={course.title} status={course.status}
          openVersion={open ? { ...open, min_completion_pct: Number(open.min_completion_pct), passing_score: Number(open.passing_score) } : null}
          publishedVersion={published?.version_number ?? null} issues={issues} org={org}
          can={{
            publish: can(ctx, "courses.publish"), update: can(ctx, "courses.update"), suspend: can(ctx, "courses.suspend"),
            archive: can(ctx, "courses.archive"), delete: can(ctx, "courses.delete"), create: can(ctx, "courses.create"), assign: can(ctx, "assignments.write"),
          }}
        />
      )}

      {step === "participantes" && (
        participants.length === 0 ? <EmptyState icon={<Users className="size-8" />} title="Nadie tiene asignado este curso todavía">Asígnalo desde el paso «Publicar y asignar».</EmptyState> : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr><th className="th">Persona</th><th className="th">Avance</th><th className="th">Estado</th><th className="th">Versión</th><th className="th">Fecha límite</th><th className="th">Tiempo</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {participants.map((p) => {
                  const overdue = p.due_at && new Date(p.due_at) < new Date() && p.progress_status !== "completed";
                  return (
                    <tr key={p.id}>
                      <td className="td">{p.user ? <Link href={`/admin/usuarios/${p.user.id}`} className="font-medium text-slate-900 hover:underline">{p.user.full_name}</Link> : "—"}<div className="text-xs text-slate-500">{p.user?.employee_number ?? ""}</div></td>
                      <td className="td">
                        <div className="flex items-center gap-2"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-600" style={{ width: `${p.progress_pct}%` }} /></div><span className="text-xs tabular-nums text-slate-600">{Math.round(p.progress_pct)}%</span></div>
                      </td>
                      <td className="td">
                        {p.state === "cancelled" ? <Badge>Cancelado</Badge> : p.result === "passed" ? <Badge tone="green">Aprobado</Badge>
                          : p.result === "failed" ? <Badge tone="red">Reprobado</Badge> : p.result === "pending_review" ? <Badge tone="amber">En revisión</Badge>
                          : p.progress_status === "completed" ? <Badge tone="green">Completado</Badge>
                          : overdue ? <Badge tone="red">Vencido</Badge> : p.progress_status === "in_progress" ? <Badge tone="blue">En progreso</Badge> : <Badge>Pendiente</Badge>}
                      </td>
                      <td className="td">{p.version ? `v${p.version.version_number}` : "—"}</td>
                      <td className="td">{p.due_at ? fmtDate(p.due_at) : "—"}</td>
                      <td className="td">{fmtDuration(p.total_seconds)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
