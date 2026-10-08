import { Activity, AlertTriangle, Award, BookOpen, Clock, FileQuestion, ShieldCheck, SquareCheckBig, Users, XCircle, type LucideIcon } from "lucide-react";

export const REPORT_ICONS: Record<string, LucideIcon> = {
  shield: ShieldCheck, alert: AlertTriangle, x: XCircle, grading: SquareCheckBig, questions: FileQuestion,
  clock: Clock, award: Award, courses: BookOpen, users: Users, activity: Activity,
};
