import type { QuestionTrace } from "./queries";

type Opt = { id: string; text: string };
const txt = (list: Opt[] | undefined, id: unknown) => list?.find((o) => o.id === id)?.text ?? "—";

/** Respuesta y clave de una pregunta en texto legible (para la pantalla y el PDF de evidencia). */
export function describeAnswer(q: QuestionTrace): { response: string; correct: string | null } {
  const s = q.snapshot, r = (q.response ?? {}) as Record<string, unknown>, k = (q.key ?? null) as Record<string, unknown> | null;
  const opts = s.options, targets = s.targets;
  const empty = q.response === null || q.response === undefined;
  switch (s.type) {
    case "single_choice":
    case "true_false":
      return { response: empty ? "Sin respuesta" : txt(opts, r.option_id), correct: k ? ((k.correct as string[]) ?? []).map((id) => txt(opts, id)).join(", ") : null };
    case "multiple_choice":
      return { response: empty ? "Sin respuesta" : ((r.option_ids as string[]) ?? []).map((id) => txt(opts, id)).join(", ") || "Ninguna",
               correct: k ? ((k.correct as string[]) ?? []).map((id) => txt(opts, id)).join(", ") : null };
    case "short_text":
      return { response: empty ? "Sin respuesta" : String(r.text ?? ""), correct: k ? ((k.accepted as string[]) ?? []).join(" / ") : null };
    case "open_text":
      return { response: empty ? "Sin respuesta" : String(r.text ?? ""), correct: null };
    case "ordering":
      return { response: empty ? "Sin respuesta" : ((r.order as string[]) ?? []).map((id) => txt(opts, id)).join(" → "),
               correct: k ? ((k.order as string[]) ?? []).map((id) => txt(opts, id)).join(" → ") : null };
    case "matching": {
      const pairs = (m: Record<string, string> | undefined) => Object.entries(m ?? {}).map(([a, b]) => `${txt(opts, a)} → ${txt(targets, b)}`).join("; ");
      return { response: empty ? "Sin respuesta" : pairs(r.pairs as Record<string, string>), correct: k ? pairs(k.pairs as Record<string, string>) : null };
    }
    case "scale":
      return { response: empty ? "Sin respuesta" : String(r.value ?? "—"), correct: null };
    default:
      return { response: JSON.stringify(q.response), correct: null };
  }
}

export const QTYPE: Record<string, string> = {
  single_choice: "Opción única", multiple_choice: "Opción múltiple", true_false: "Verdadero/Falso", short_text: "Respuesta corta",
  open_text: "Respuesta abierta", ordering: "Ordenar", matching: "Relacionar", scale: "Escala",
};
export const ATTEMPT_STATUS: Record<string, string> = { in_progress: "En curso", submitted: "Entregado", pending_review: "En revisión", graded: "Calificado", voided: "Anulado" };
export const EVENT_LABEL: Record<string, string> = {
  started: "Inició", resumed: "Retomó", session_takeover: "Continuó en otro dispositivo", focus_lost: "Salió de la pestaña",
  submitted: "Entregó", auto_submitted: "Se entregó solo (tiempo agotado)", voided: "Anulado", regraded: "Recalificado",
};
export const EXCEPTION_LABEL: Record<string, string> = {
  due_extension: "Prórroga", expiry_extension: "Ampliación de vigencia", extra_attempts: "Intento extra", late_access: "Acceso tardío",
  reassign: "Reasignado (ciclo nuevo)", cancel: "Cancelado",
};
