import type { Metadata } from "next";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Mis cursos" };

export default function Page() {
  return (
    <>
      <PageHeader title="Mis cursos" description="Aquí verás todos los cursos que te asignen, obligatorios primero." />
      <EmptyState title="Sin registros por ahora">Esta sección se activa cuando tengas cursos asignados.</EmptyState>
    </>
  );
}
