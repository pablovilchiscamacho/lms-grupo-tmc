import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History, Users } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { getCourse, getVersionTree } from "@/features/courses/queries";
import { enrollmentsFor, examsByVersion } from "@/features/assignments/queries";
import { EnrollmentTable } from "@/features/assignments/ui/enrollment-table";
import { getOrgOptions } from "@/features/org/queries";
import { getPublishIssues, updateCourse } from "@/features/courses/actions";
import { CourseForm } from "@/features/courses/ui/course-form";
import { ContentBuilder } from "@/features/courses/ui/content-builder";
import { PublishPanel } from "@/features/courses/ui/publish-panel";
import { Stepper, type StepKey } from "@/features/courses/ui/stepper";
import { conversionEnabled } from "@/lib/conversion";
import { getExams, listQuestionCategories } from "@/features/exams/queries";
import { ExamBuilder } from "@/features/exams/ui/exam-builder";
import { COURSE_STATUS, fmtDate } from "@/lib/format";
import { Badge, Card, EmptyState } from "@/components/ui";
import { AuditList } from "@/components/audit-list";
import { courseHistory, courseVersionsTrace } from "@/features/traceability/queries";

export const metadata: Metadata = { title: "Curso" };

export default async function CoursePage({ params, searchParams }: PageProps<"/admin/cursos/[id]">) {
  const { id } = await params;
  const ctx = await requirePermission("courses.read", `/admin/cursos/${id}`);
  const sp = await searchParams;
  const course = await getCourse(id);
  if (!course) notFound();
  const step = (["datos", "contenido", "examen", "publicar", "participantes", "historial"].includes(String(sp.paso)) ? sp.paso : "contenido") as StepKey;

  const open = course.versions.find((v) => v.status === "draft" || v.status === "review") ?? null;
  const published = course.versions.find((v) => v.status === "published") ?? null;
  const shown = open ?? published ?? course.versions[0];
  const [label, tone] = COURSE_STATUS[course.status] ?? [course.status, "slate"];

  const [exams, categories] = step === "examen" ? await Promise.all([getExams(shown.id), listQuestionCategories()]) : [[], []];
  const [tree, org, issues, participants] = await Promise.all([
    step === "contenido" ? getVersionTree(shown.id) : Promise.resolve([]),
    step === "datos" || step === "publicar" ? getOrgOptions() : Promise.resolve(null),
    step === "publicar" && open ? getPublishIssues(open.id) : Promise.resolve([]),
    step === "participantes" ? enrollmentsFor({ course: course.id }) : Promise.resolve([]),
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
          <Link href={`?paso=historial`} className="btn-secondary"><History className="size-4" /> Historial</Link>
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

      {step === "historial" && <CourseHistory courseId={course.id} />}

      {step === "participantes" && (
        participants.length === 0 ? <EmptyState icon={<Users className="size-8" />} title="Nadie tiene asignado este curso todavía">Asígnalo desde el paso «Publicar y asignar».</EmptyState> : (
          <div className="card"><EnrollmentTable rows={participants} exams={await examsByVersion(participants.map((p) => p.course_version_id ?? ""))}
            canAdjust={can(ctx, "enrollments.adjust")} revalidate={`/admin/cursos/${course.id}`} show={{ user: true }} /></div>
        )
      )}
    </>
  );
}

const VSTATUS: Record<string, [string, "green" | "amber" | "slate" | "blue"]> = {
  published: ["Vigente", "green"], draft: ["En edición", "amber"], review: ["En revisión", "blue"], retired: ["Reemplazada", "slate"], archived: ["Archivada", "slate"],
};

/** Trazabilidad del curso (ISO §59): quién lo creó, cada versión con quién la publicó y qué cambió, y todos los cambios. */
async function CourseHistory({ courseId }: { courseId: string }) {
  const [t, log] = await Promise.all([courseVersionsTrace(courseId), courseHistory(courseId).catch(() => null)]);
  return (
    <div className="space-y-6">
      <Card title="Versiones">
        <p className="mb-3 text-sm text-slate-600">Creado por <strong>{t.course.created_by ?? "—"}</strong> el {fmtDate(t.course.created_at)}. Cada persona conserva la versión que tomó, aunque después se publique otra.</p>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-y border-slate-200 bg-slate-50">
              <tr><th className="th">Versión</th><th className="th">Estado</th><th className="th">Qué cambió</th><th className="th">Publicada</th><th className="th text-right">La tomaron</th><th className="th text-right">Terminaron</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {t.versions.map((v) => {
                const [l, tone] = VSTATUS[v.status] ?? [v.status, "slate"];
                return (
                  <tr key={v.id}>
                    <td className="td font-medium text-slate-900">v{v.number}</td>
                    <td className="td"><Badge tone={tone}>{l}</Badge>{v.requires_retraining && <div className="mt-0.5 text-xs text-amber-700">Pidió recapacitación</div>}</td>
                    <td className="td text-sm text-slate-700">{v.change_summary ?? <span className="text-slate-400">—</span>}</td>
                    <td className="td text-sm text-slate-600">{v.published_at ? <>{fmtDate(v.published_at)}<div className="text-xs text-slate-500">por {v.published_by ?? "—"}</div></> : "—"}</td>
                    <td className="td text-right tabular-nums">{v.took}</td>
                    <td className="td text-right tabular-nums">{v.passed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Todos los cambios">
        {log === null ? <p className="text-sm text-slate-500">No tienes permiso para ver la bitácora de este curso.</p>
          : log.length === 0 ? <EmptyState title="Sin cambios registrados" /> : <AuditList entries={log} />}
      </Card>
    </div>
  );
}

