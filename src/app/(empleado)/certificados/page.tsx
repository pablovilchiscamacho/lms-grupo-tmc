import type { Metadata } from "next";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Certificados" };

export default function Page() {
  return (
    <>
      <PageHeader title="Certificados" description="Los certificados de los cursos que apruebes, listos para descargar." />
      <EmptyState title="Sin registros por ahora">Esta sección se activa cuando tengas cursos asignados.</EmptyState>
    </>
  );
}
