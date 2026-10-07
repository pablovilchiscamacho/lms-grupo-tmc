import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { pendingReviews } from "@/features/grading/queries";
import { GradingInbox } from "@/features/grading/grading-inbox";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Calificar" };

export default async function GradingPage() {
  await requirePermission("grading.grade", "/admin/calificaciones");
  const items = await pendingReviews();
  return (
    <>
      <PageHeader title="Exámenes pendientes de revisión" description={items.length ? `${items.length} respuesta${items.length === 1 ? "" : "s"} abierta${items.length === 1 ? "" : "s"} por calificar. Al terminar, la calificación final se recalcula sola.` : undefined} />
      <GradingInbox items={items} />
    </>
  );
}
