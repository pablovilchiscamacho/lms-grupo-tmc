import type { Metadata } from "next";
import { homeCompany, requirePermission } from "@/lib/auth/session";
import { getOrgOptions } from "@/features/org/queries";
import { createCourse } from "@/features/courses/actions";
import { CourseForm } from "@/features/courses/ui/course-form";
import { Card, PageHeader } from "@/components/ui";
import { Stepper } from "@/features/courses/ui/stepper";

export const metadata: Metadata = { title: "Nuevo curso" };

export default async function NewCoursePage() {
  const ctx = await requirePermission("courses.create", "/admin/cursos/nuevo");
  const org = await getOrgOptions();
  const home = homeCompany(ctx);
  return (
    <>
      <PageHeader title="Nuevo curso" />
      <Stepper current="datos" />
      <Card><CourseForm mode="create" action={createCourse} allowGroup={!home}
        companies={home ? org.companies.filter((c) => c.id === home) : org.companies} /></Card>
    </>
  );
}
