import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { myEnrollments } from "@/features/learning/queries";
import { CourseCard } from "@/features/learning/ui/course-card";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Mis cursos" };

export default async function MyCoursesPage() {
  const ctx = await requireUser();
  const list = await myEnrollments();
  return (
    <>
      <PageHeader title="Mis cursos" description="Los obligatorios aparecen primero." />
      {list.length === 0 ? <EmptyState icon={<BookOpen className="size-8" />} title="Aún no tienes cursos asignados">Cuando te asignen uno aparecerá aquí.</EmptyState> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.map((e) => <CourseCard key={e.id} e={e} tz={ctx.profile.company.timezone} />)}</div>
      )}
    </>
  );
}
