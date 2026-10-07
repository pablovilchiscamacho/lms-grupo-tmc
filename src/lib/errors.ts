/**
 * Traduce errores técnicos a mensajes claros (SECURITY.md §9 · nunca mostrar "PostgrestError 23505").
 * Los códigos propios vienen de app.fail(...) en la base.
 */
const BUSINESS: Record<string, string> = {
  FORBIDDEN: "No tienes permiso para realizar esta acción.",
  NOT_FOUND: "No encontramos el registro solicitado.",
  VALIDATION: "Revisa los datos marcados.",
  ORG_MISMATCH: "La sucursal, el departamento o el puesto no pertenecen a la empresa seleccionada.",
  HIERARCHY_CYCLE: "Esa relación crearía un ciclo (alguien terminaría siendo jefe de su propio jefe).",
  INVALID_SCOPE: "El alcance seleccionado no existe.",
  CANNOT_CHANGE_SELF: "No puedes cambiar tu propio estado o tus propios roles.",
  LAST_SUPER_ADMIN: "Debe quedar al menos un Super Admin activo.",
  USER_DELETED: "El usuario fue dado de baja; no se puede modificar su estado.",
  ROLE_ALREADY_ASSIGNED: "El usuario ya tiene ese rol con ese alcance.",
  IMPORT_TOO_LARGE: "El archivo tiene demasiadas filas (máximo 2,000 por importación).",
  AUDIT_IMMUTABLE: "La bitácora no se puede modificar.",
  RATE_LIMITED: "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
  VERSION_LOCKED: "Esta versión ya está publicada y no se puede modificar. Usa «Editar contenido» para crear una versión nueva.",
  REVIEW_REQUIRED: "Este curso debe pasar por revisión antes de publicarse.",
  INVALID_TRANSITION: "Ese cambio de estado no está permitido para el curso.",
  COURSE_ARCHIVED: "El curso está archivado.",
  COURSE_HAS_HISTORY: "El curso ya tiene personas asignadas, así que no se puede borrar. Puedes archivarlo.",
  NOT_ENROLLED: "No tienes asignado este curso.",
  COURSE_SUSPENDED: "Este curso está suspendido temporalmente.",
  COURSE_NOT_AVAILABLE: "Este curso todavía no está disponible.",
  NOT_YET_AVAILABLE: "Este curso todavía no está disponible.",
  ACCESS_EXPIRED: "El plazo para tomar este curso ya terminó. Habla con tu administrador.",
  LESSON_LOCKED: "Primero completa las lecciones anteriores.",
  LESSON_NOT_VIEWED: "Primero abre la lección.",
  LESSON_RULE_NOT_MET: "Aún no cumples lo necesario para completar esta lección.",
  FILE_TYPE_NOT_ALLOWED: "Ese tipo de archivo no está permitido. Usa PDF, PowerPoint, Word, Excel, MP4, JPG o PNG.",
  ACADEMIC_RECORD_PROTECTED: "El historial de capacitación no se puede borrar.",
};

/** Mensajes que incluyen el detalle que manda la base. */
const WITH_DETAIL: Record<string, (d: string) => string> = {
  PUBLISH_BLOCKED: (d) => `Antes de publicar falta: ${d.split(" | ").join(" ")}`,
  PREREQUISITE_MISSING: (d) => `Antes debes completar el curso «${d}».`,
  FILE_TOO_LARGE: (d) => `El archivo es demasiado grande (máximo ${d} MB).`,
};

/** Restricciones únicas → mensaje (código Postgres 23505). */
const UNIQUE: Record<string, string> = {
  profiles_email_key: "Este correo ya está registrado.",
  profiles_auth_email_key: "Este correo ya está registrado.",
  profiles_username_key: "Ese nombre de usuario ya está en uso.",
  profiles_company_employee_key: "Ese número de empleado ya existe en la empresa.",
  companies_name_key: "Ya existe una empresa con ese nombre.",
  companies_short_name_key: "Ya existe una empresa con esa abreviatura.",
  branches_company_code_key: "Ya existe una sucursal con esa clave en la empresa.",
  departments_company_code_key: "Ya existe un departamento con esa clave en la empresa.",
  positions_company_code_key: "Ya existe un puesto con esa clave en la empresa.",
  courses_code_key: "Ya existe un curso con esa clave.",
};

/** Mensajes por campo para errores de validación ({"email":"taken"}). */
export const FIELD_MESSAGES: Record<string, string> = {
  required: "Obligatorio",
  taken: "Ya está registrado",
  invalid: "Formato inválido",
  not_found: "No existe",
  org_mismatch: "No pertenece a la empresa seleccionada",
  self: "No puede ser la misma persona",
  cycle: "Crearía un ciclo en la línea de reporte",
  past: "La fecha ya pasó",
};

export type FriendlyError = { code: string; message: string; fieldErrors?: Record<string, string> };

type PgLike = { code?: string; message?: string; details?: string; detail?: string };

export function toFriendlyError(e: unknown): FriendlyError {
  const err = (e ?? {}) as PgLike;
  const code = err.code;
  const message = err.message ?? "";
  const detail = err.details ?? err.detail ?? "";

  if (code === "P0001" || BUSINESS[message] || WITH_DETAIL[message]) {
    if (message === "VALIDATION" && detail.startsWith("{")) {
      try {
        const raw = JSON.parse(detail) as Record<string, string>;
        const fieldErrors = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, FIELD_MESSAGES[v] ?? v]));
        return { code: message, message: BUSINESS.VALIDATION, fieldErrors };
      } catch {
        /* sigue abajo */
      }
    }
    if (WITH_DETAIL[message] && detail) return { code: message, message: WITH_DETAIL[message](detail) };
    if (BUSINESS[message]) return { code: message, message: BUSINESS[message] };
  }
  if (code === "23505") {
    const key = Object.keys(UNIQUE).find((k) => message.includes(k) || detail.includes(k));
    return { code, message: key ? UNIQUE[key] : "Ese registro ya existe." };
  }
  if (code === "23503") return { code, message: "El registro está relacionado con otros datos y no se puede completar la operación." };
  if (code === "23514") return { code, message: "Algún dato no cumple el formato requerido." };
  if (code === "42501") return { code: "FORBIDDEN", message: BUSINESS.FORBIDDEN };
  return { code: "UNKNOWN", message: "Ocurrió un problema. Inténtalo de nuevo; si persiste, avisa a tu administrador." };
}
