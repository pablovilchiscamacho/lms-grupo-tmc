import type { Metadata } from "next";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Avisos" };

export default function Page() {
  return (
    <>
      <PageHeader title="Avisos" description="Nuevos cursos asignados, fechas próximas a vencer y resultados." />
      <EmptyState title="Sin registros por ahora">Esta sección se activa cuando tengas cursos asignados.</EmptyState>
    </>
  );
}
