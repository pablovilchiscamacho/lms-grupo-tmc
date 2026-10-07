import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { publishedCourses } from "@/features/assignments/queries";
import { getOrgOptions } from "@/features/org/queries";
import { AssignmentWizard } from "@/features/assignments/ui/assignment-wizard";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Nueva asignación" };

export default async function NewAssignmentPage({ searchParams }: PageProps<"/admin/asignaciones/nueva">) {
  await requirePermission("assignments.write", "/admin/asignaciones/nueva");
  const sp = await searchParams;
  const [courses, org] = await Promise.all([publishedCourses(), getOrgOptions()]);
  return (
    <>
      <Link href="/admin/asignaciones" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Asignaciones</Link>
      <PageHeader title="Asignar un curso" />
      <AssignmentWizard courses={courses} org={org} initialCourse={typeof sp.curso === "string" ? sp.curso : undefined} />
    </>
  );
}
