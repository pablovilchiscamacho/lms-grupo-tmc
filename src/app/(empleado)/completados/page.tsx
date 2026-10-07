import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { myEnrollments } from "@/features/learning/queries";
import { CourseCard } from "@/features/learning/ui/course-card";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Completados" };

export default async function Page() {
  const ctx = await requireUser();
  const list = (await myEnrollments()).filter((e) => e.progress_status === "completed");
  return (
    <>
      <PageHeader title="Completados" />
      {list.length === 0 ? <EmptyState title="Todavía no completas cursos" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.map((e) => <CourseCard key={e.id} e={e} tz={ctx.profile.company.timezone} />)}</div>
      )}
    </>
  );
}
