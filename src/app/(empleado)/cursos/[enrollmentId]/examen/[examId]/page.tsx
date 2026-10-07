import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { myCourseExams } from "@/features/attempts/queries";
import { ExamIntro } from "@/features/attempts/ui/exam-room";

export const metadata: Metadata = { title: "Examen" };

export default async function ExamPage({ params }: PageProps<"/cursos/[enrollmentId]/examen/[examId]">) {
  await requireUser();
  const { enrollmentId, examId } = await params;
  const exam = (await myCourseExams(enrollmentId)).find((e) => e.id === examId);
  if (!exam) notFound();
  return <ExamIntro key={exam.open_attempt ?? exam.used} exam={exam} enrollmentId={enrollmentId} />;
}
