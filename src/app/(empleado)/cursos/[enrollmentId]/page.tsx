import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPlayer } from "@/features/learning/queries";

/** Entra al curso en la primera lección pendiente que esté desbloqueada. */
export default async function EnterCourse({ params }: PageProps<"/cursos/[enrollmentId]">) {
  await requireUser();
  const { enrollmentId } = await params;
  const player = await getPlayer(enrollmentId);
  if (!player) notFound();
  const lessons = player.modules.flatMap((m) => m.lessons);
  if (!lessons.length) notFound();
  const target = lessons.find((l) => !l.locked && l.status !== "completed") ?? lessons[0];
  redirect(`/cursos/${enrollmentId}/leccion/${target.id}`);
}
