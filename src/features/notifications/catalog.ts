/** Tipos de aviso y a quién le llegan (para la configuración del correo). */
export const NOTIFICATION_TYPES: { key: string; label: string; who: "Empleado" | "Quien califica" | "Jefe" }[] = [
  { key: "course_assigned", label: "Se le asignó un curso", who: "Empleado" },
  { key: "due_soon", label: "Recordatorio: su curso está por vencer", who: "Empleado" },
  { key: "overdue", label: "Su curso venció", who: "Empleado" },
  { key: "course_passed", label: "Aprobó un curso", who: "Empleado" },
  { key: "course_failed", label: "Reprobó un curso", who: "Empleado" },
  { key: "course_completed", label: "Terminó un curso sin examen", who: "Empleado" },
  { key: "certificate_ready", label: "Su constancia está lista", who: "Empleado" },
  { key: "attempt_graded", label: "Ya se calificó su examen", who: "Empleado" },
  { key: "extension", label: "Se le dio una prórroga", who: "Empleado" },
  { key: "extra_attempts", label: "Se le dio otro intento", who: "Empleado" },
  { key: "retraining", label: "Debe tomar de nuevo un curso actualizado", who: "Empleado" },
  { key: "renewal", label: "Debe renovar un curso por vigencia", who: "Empleado" },
  { key: "cancelled", label: "Se canceló una asignación", who: "Empleado" },
  { key: "review_pending", label: "Hay un examen por calificar", who: "Quien califica" },
  { key: "team_overdue", label: "Resumen semanal (lunes) de su equipo atrasado", who: "Jefe" },
];

export type EmailSettings = { enabled: boolean; from: string; reply_to: string | null; app_url: string; types: Record<string, boolean> };
export type ReminderSettings = { days_before: number[]; overdue: boolean; overdue_every_days: number; manager_digest: boolean };
export type EmailStatus = { email: EmailSettings; reminders: ReminderSettings; has_key: boolean; pending: number; sent_7d: number; failed_7d: number };
