import type { Metadata } from "next";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "En progreso" };

export default function Page() {
  return (
    <>
      <PageHeader title="En progreso" description="Los cursos que ya empezaste y puedes continuar." />
      <EmptyState title="Sin registros por ahora">Esta sección se activa cuando tengas cursos asignados.</EmptyState>
    </>
  );
}
