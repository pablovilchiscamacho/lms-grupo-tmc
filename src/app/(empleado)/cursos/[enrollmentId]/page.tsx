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
  // Con todas las lecciones obligatorias terminadas, entra directo al examen pendiente.
  const exam = player.exams.find((x) => !x.passed && !x.locked);
  if (exam && lessons.every((l) => !l.is_required || l.status === "completed")) redirect(`/cursos/${enrollmentId}/examen/${exam.id}`);
  if (!lessons.length) notFound();
  const target = lessons.find((l) => !l.locked && l.status !== "completed") ?? lessons[0];
  redirect(`/cursos/${enrollmentId}/leccion/${target.id}`);
}
