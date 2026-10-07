import type { Metadata } from "next";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Completados" };

export default function Page() {
  return (
    <>
      <PageHeader title="Completados" description="Tu historial de cursos terminados, con calificación y fecha." />
      <EmptyState title="Sin registros por ahora">Esta sección se activa cuando tengas cursos asignados.</EmptyState>
    </>
  );
}
