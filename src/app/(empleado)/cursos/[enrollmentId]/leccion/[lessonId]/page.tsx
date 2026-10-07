import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPlayer } from "@/features/learning/queries";
import { PlayerView } from "@/features/learning/ui/player";

export const metadata: Metadata = { title: "Curso" };

export default async function LessonPage({ params }: PageProps<"/cursos/[enrollmentId]/leccion/[lessonId]">) {
  await requireUser();
  const { enrollmentId, lessonId } = await params;
  const player = await getPlayer(enrollmentId);
  if (!player) notFound();
  const lesson = player.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId);
  if (!lesson) notFound();
  // Lección bloqueada (curso en orden): se regresa a la primera pendiente. El servidor también lo impide.
  if (lesson.locked) redirect(`/cursos/${enrollmentId}`);
  return <PlayerView key={lessonId} player={player} lessonId={lessonId} />;
}
