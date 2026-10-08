/** Catálogo de reportes (§24): columnas, filtros y textos. Se comparte entre la pantalla y las exportaciones. */

export type ColType = "text" | "date" | "datetime" | "int" | "num" | "pct" | "hours" | "bool" | "enum";
export type Column = { key: string; label: string; type: ColType; width?: number; enum?: Record<string, string> };
export type FilterKey = "q" | "empresa" | "sucursal" | "departamento" | "puesto" | "jefe" | "curso" | "fechas" | "estado";
export type ReportDef = {
  key: string; slug: string; title: string; description: string; icon: string;
  columns: Column[]; filters: FilterKey[]; dateLabel?: string; status?: [string, string][]; note?: string;
};

export const USER_STATUS = { active: "Activo", inactive: "Inactivo", suspended: "Suspendido", deleted: "Baja" };
export const COURSE_STATUS = { draft: "Borrador", in_review: "En revisión", published: "Publicado", suspended: "Suspendido", archived: "Archivado" };
export const REQUIREMENT = { mandatory: "Obligatorio", recommended: "Recomendado", optional: "Opcional" };
export const RESULT = { passed: "Aprobado", failed: "Reprobado", pending_review: "En revisión", none: "Sin examen", voided: "Anulado", submitted: "Entregado", graded: "Calificado" };
export const SUBMIT = { user: "La persona", timeout: "Tiempo agotado", admin: "Administrador" };
export const CERT_STATUS = { valid: "Vigente", expired: "Vencida", revoked: "Revocada" };
export const EVENT = {
  assigned: "Curso asignado", started: "Inició el curso", completed: "Terminó el contenido", passed: "Aprobó", failed: "Reprobó",
  cancelled: "Asignación cancelada", exam_submitted: "Presentó examen", certificate_issued: "Constancia emitida", certificate_revoked: "Constancia revocada",
};

const PERSON: Column[] = [
  { key: "numero", label: "Número", type: "text", width: 9 },
  { key: "nombre", label: "Nombre", type: "text", width: 26 },
  { key: "empresa", label: "Empresa", type: "text", width: 9 },
];
const DEPT: Column = { key: "departamento", label: "Departamento", type: "text", width: 18 };
const ORG: FilterKey[] = ["q", "empresa", "sucursal", "departamento", "puesto", "jefe"];

export const REPORTS: ReportDef[] = [
  {
    key: "compliance", slug: "cumplimiento", icon: "shield", title: "Cumplimiento",
    description: "Por persona: cursos obligatorios asignados, completados, pendientes, vencidos y su semáforo.",
    filters: [...ORG, "curso", "fechas"], dateLabel: "Asignados",
    columns: [...PERSON, { key: "sucursal", label: "Sucursal", type: "text", width: 14 }, DEPT, { key: "puesto", label: "Puesto", type: "text", width: 18 },
      { key: "jefe", label: "Jefe", type: "text", width: 22 }, { key: "asignados", label: "Asignados", type: "int" }, { key: "completados", label: "Completados", type: "int" },
      { key: "pendientes", label: "Pendientes", type: "int" }, { key: "vencidos", label: "Vencidos", type: "int" }, { key: "reprobados", label: "Reprobados", type: "int" },
      { key: "cumplimiento", label: "Cumplimiento", type: "pct" }, { key: "semaforo", label: "Semáforo", type: "text", width: 10 }, { key: "promedio", label: "Promedio", type: "pct" }],
    note: "Solo cursos obligatorios vigentes de personas activas.",
  },
  {
    key: "overdue", slug: "vencidos", icon: "alert", title: "Cursos vencidos",
    description: "Quién tiene cursos con la fecha límite vencida, cuántos días de atraso y su avance.",
    filters: [...ORG, "curso", "fechas"], dateLabel: "Fecha límite",
    columns: [...PERSON, DEPT, { key: "jefe", label: "Jefe", type: "text", width: 22 }, { key: "curso", label: "Curso", type: "text", width: 28 },
      { key: "tipo", label: "Tipo", type: "enum", enum: REQUIREMENT }, { key: "asignado", label: "Asignado", type: "date" },
      { key: "fecha_limite", label: "Fecha límite", type: "date" }, { key: "dias_atraso", label: "Días de atraso", type: "int" }, { key: "avance", label: "Avance", type: "pct" }],
  },
  {
    key: "failed", slug: "reprobados", icon: "x", title: "Personas reprobadas",
    description: "Quién agotó sus intentos sin aprobar, para darle seguimiento o un intento extra.",
    filters: [...ORG, "curso", "fechas"], dateLabel: "Reprobó",
    columns: [...PERSON, DEPT, { key: "jefe", label: "Jefe", type: "text", width: 22 }, { key: "curso", label: "Curso", type: "text", width: 28 },
      { key: "calificacion", label: "Calificación", type: "pct" }, { key: "intentos", label: "Intentos", type: "int" }, { key: "fecha", label: "Fecha", type: "date" }],
  },
  {
    key: "grades", slug: "calificaciones", icon: "grading", title: "Calificaciones",
    description: "Calificación final de cada persona en cada curso, con su resultado y número de intentos.",
    filters: [...ORG, "curso", "fechas", "estado"], dateLabel: "Resultado", status: [["passed", "Aprobados"], ["failed", "Reprobados"], ["pending_review", "En revisión"]],
    columns: [...PERSON, DEPT, { key: "curso", label: "Curso", type: "text", width: 28 }, { key: "clave", label: "Clave", type: "text", width: 10 },
      { key: "version", label: "Versión", type: "int" }, { key: "ciclo", label: "Ciclo", type: "int" }, { key: "calificacion", label: "Calificación", type: "pct" },
      { key: "resultado", label: "Resultado", type: "enum", enum: RESULT }, { key: "fecha", label: "Fecha", type: "date" }, { key: "intentos", label: "Intentos", type: "int" }],
  },
  {
    key: "exams", slug: "examenes", icon: "questions", title: "Exámenes",
    description: "Cada intento presentado: inicio, entrega, duración, calificación y resultado.",
    filters: [...ORG, "curso", "fechas"], dateLabel: "Entregados",
    columns: [...PERSON, DEPT, { key: "curso", label: "Curso", type: "text", width: 24 }, { key: "examen", label: "Examen", type: "text", width: 18 },
      { key: "intento", label: "Intento", type: "int" }, { key: "inicio", label: "Inicio", type: "datetime" }, { key: "entrega", label: "Entrega", type: "datetime" },
      { key: "minutos", label: "Minutos", type: "num" }, { key: "calificacion", label: "Calificación", type: "pct" }, { key: "resultado", label: "Resultado", type: "enum", enum: RESULT },
      { key: "entregado_por", label: "Entregó", type: "enum", enum: SUBMIT }, { key: "motivo_anulacion", label: "Motivo de anulación", type: "text", width: 24 }],
  },
  {
    key: "hours", slug: "horas", icon: "clock", title: "Horas de capacitación",
    description: "Tiempo dedicado por persona (lecciones y exámenes), total y en cursos terminados.",
    filters: [...ORG, "curso", "fechas"], dateLabel: "Asignados",
    columns: [...PERSON, { key: "sucursal", label: "Sucursal", type: "text", width: 14 }, DEPT, { key: "puesto", label: "Puesto", type: "text", width: 18 },
      { key: "cursos", label: "Cursos con tiempo", type: "int" }, { key: "horas", label: "Horas", type: "hours" }, { key: "horas_terminados", label: "Horas en terminados", type: "hours" }],
    note: "El tiempo cuenta solo con la lección abierta y activa (máximo 1 minuto por señal).",
  },
  {
    key: "certificates", slug: "certificados", icon: "award", title: "Certificados",
    description: "Constancias emitidas, su vigencia y si alguna fue revocada.",
    filters: [...ORG, "curso", "fechas", "estado"], dateLabel: "Emitidas", status: [["valid", "Vigentes"], ["expired", "Vencidas"], ["revoked", "Revocadas"]],
    columns: [{ key: "folio", label: "Folio", type: "text", width: 17 }, ...PERSON, DEPT, { key: "curso", label: "Curso", type: "text", width: 26 },
      { key: "clave", label: "Clave", type: "text", width: 10 }, { key: "emision", label: "Emisión", type: "date" }, { key: "vigencia", label: "Vigencia", type: "date" },
      { key: "calificacion", label: "Calificación", type: "pct" }, { key: "estado", label: "Estado", type: "enum", enum: CERT_STATUS },
      { key: "motivo_revocacion", label: "Motivo de revocación", type: "text", width: 24 }],
  },
  {
    key: "courses", slug: "cursos", icon: "courses", title: "Cursos",
    description: "Cada curso con su estado, vigencia y resultados: asignados, completados, vencidos, reprobados y promedio.",
    filters: ["empresa", "sucursal", "departamento", "puesto", "jefe", "curso", "fechas", "estado"], dateLabel: "Asignados",
    status: [["published", "Publicados"], ["draft", "Borradores"], ["suspended", "Suspendidos"], ["archived", "Archivados"]],
    columns: [{ key: "clave", label: "Clave", type: "text", width: 10 }, { key: "curso", label: "Curso", type: "text", width: 30 },
      { key: "estado", label: "Estado", type: "enum", enum: COURSE_STATUS }, { key: "version", label: "Versión", type: "int" },
      { key: "tipo", label: "Tipo", type: "enum", enum: REQUIREMENT }, { key: "vigencia_meses", label: "Vigencia (meses)", type: "int" },
      { key: "constancia", label: "Da constancia", type: "bool" }, { key: "asignados", label: "Asignados", type: "int" }, { key: "en_progreso", label: "En progreso", type: "int" },
      { key: "completados", label: "Completados", type: "int" }, { key: "vencidos", label: "Vencidos", type: "int" }, { key: "reprobados", label: "Reprobados", type: "int" },
      { key: "cumplimiento", label: "Cumplimiento", type: "pct" }, { key: "promedio", label: "Promedio", type: "pct" }, { key: "horas", label: "Horas", type: "hours" }],
  },
  {
    key: "users", slug: "usuarios", icon: "users", title: "Usuarios",
    description: "Padrón de personas con su organización, jefe, estado, último acceso y cursos.",
    filters: [...ORG, "estado"], status: Object.entries(USER_STATUS).filter(([k]) => k !== "deleted"),
    columns: [...PERSON, { key: "correo", label: "Correo o usuario", type: "text", width: 26 }, { key: "sucursal", label: "Sucursal", type: "text", width: 14 }, DEPT,
      { key: "puesto", label: "Puesto", type: "text", width: 18 }, { key: "jefe", label: "Jefe", type: "text", width: 22 }, { key: "estado", label: "Estado", type: "enum", enum: USER_STATUS },
      { key: "ingreso", label: "Ingreso", type: "date" }, { key: "ultimo_acceso", label: "Último acceso", type: "datetime" },
      { key: "asignados", label: "Cursos asignados", type: "int" }, { key: "completados", label: "Completados", type: "int" }],
  },
  {
    key: "activity", slug: "actividad", icon: "activity", title: "Actividad",
    description: "Bitácora de capacitación: asignaciones, avance, exámenes, aprobaciones y constancias.",
    filters: [...ORG, "curso", "fechas"], dateLabel: "Periodo",
    columns: [{ key: "fecha", label: "Fecha", type: "datetime" }, ...PERSON, DEPT, { key: "evento", label: "Evento", type: "enum", enum: EVENT, width: 20 },
      { key: "curso", label: "Curso", type: "text", width: 26 }, { key: "detalle", label: "Detalle", type: "text", width: 28 }],
    note: "Sin periodo elegido muestra los últimos 30 días.",
  },
];

export const reportBySlug = (slug: string) => REPORTS.find((r) => r.slug === slug);
