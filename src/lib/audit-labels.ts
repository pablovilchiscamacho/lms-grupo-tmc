/** Textos legibles para la bitácora. */
export const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Inició sesión",
  "auth.logout": "Cerró sesión",
  "auth.login_failed": "Intento de acceso fallido",
  "auth.password_changed": "Cambió su contraseña",
  "auth.mfa_enrolled": "Configuró la verificación en dos pasos",
  "auth.mfa_verified": "Verificó su segundo factor",
  "user.created": "Usuario creado",
  "user.updated": "Usuario modificado",
  "user.invited": "Invitación enviada",
  "user.password_reset": "Contraseña restablecida por un administrador",
  "user.ban_changed": "Acceso bloqueado o desbloqueado",
  "user.imported": "Usuarios importados",
  "user_role.created": "Rol asignado",
  "user_role.updated": "Rol revocado",
  "company.created": "Empresa creada",
  "company.updated": "Empresa modificada",
  "branch.created": "Sucursal creada",
  "branch.updated": "Sucursal modificada",
  "department.created": "Departamento creado",
  "department.updated": "Departamento modificado",
  "position.created": "Puesto creado",
  "position.updated": "Puesto modificado",
  "setting.created": "Configuración creada",
  "setting.updated": "Configuración modificada",
  "role_permission.created": "Permiso agregado a un rol",
  "role_permission.deleted": "Permiso quitado de un rol",
  "user_group.created": "Grupo creado",
  "user_group.updated": "Grupo modificado",
  "user_group_member.created": "Miembro agregado a grupo",
  "user_group_member.deleted": "Miembro quitado de grupo",
  "course.created": "Curso creado",
  "course.updated": "Curso modificado",
  "course.published": "Curso publicado",
  "course_version.created": "Nueva versión de curso",
  "course_version.updated": "Versión de curso modificada (o publicada)",
  "exam_attempt.created": "Intento de examen iniciado",
  "exam_attempt.updated": "Intento de examen entregado o calificado",
  "manual_grade.created": "Respuesta calificada a mano",
  "certificate.created": "Constancia emitida",
  "certificate.updated": "Constancia modificada (PDF generado o revocada)",
  "enrollment.created": "Curso asignado a una persona",
  "enrollment.updated": "Avance o resultado de un curso",
  "enrollment_exception.created": "Ajuste a una asignación (prórroga, intento extra…)",
  "assignment.created": "Asignación creada",
  "report.exported": "Reporte exportado",
  "settings.notifications_updated": "Configuración de notificaciones modificada",
};

export const ENTITY_LABEL: Record<string, string> = {
  user: "Usuario", company: "Empresa", branch: "Sucursal", department: "Departamento", position: "Puesto",
  user_role: "Rol", setting: "Configuración", role_permission: "Permiso", user_group: "Grupo", user_group_member: "Grupo",
  course: "Curso", course_version: "Versión de curso", course_module: "Módulo", lesson: "Lección", lesson_content: "Contenido de lección",
  course_instructor: "Instructor de curso", course_prerequisite: "Prerrequisito", file: "Archivo", assignment: "Asignación",
  enrollment: "Curso asignado", enrollment_exception: "Ajuste a una asignación", lesson_progress: "Avance de lección",
  question: "Pregunta", exam: "Examen", exam_item: "Pregunta de examen", exam_pool: "Preguntas al azar", exam_attempt: "Intento de examen",
  manual_grade: "Calificación manual", certificate: "Constancia", report: "Reporte",
};

export const FIELD_LABEL: Record<string, string> = {
  first_name: "Nombre", last_name_paternal: "Apellido paterno", last_name_maternal: "Apellido materno", email: "Correo",
  auth_email: "Correo de acceso", has_real_email: "Tiene correo", phone: "Teléfono", employee_number: "Núm. de empleado",
  username: "Usuario", company_id: "Empresa", branch_id: "Sucursal", department_id: "Departamento", position_id: "Puesto",
  manager_id: "Jefe directo", hire_date: "Fecha de ingreso", status: "Estado", status_reason: "Motivo",
  must_change_password: "Cambio de contraseña obligatorio", name: "Nombre", short_name: "Abreviatura", code: "Clave",
  is_active: "Activo", revoked_at: "Revocado", role_id: "Rol", scope_type: "Alcance", scope_id: "Ámbito", expires_at: "Vence",
  timezone: "Zona horaria", value: "Valor",
};

const VERB: Record<string, string> = { created: "Alta", updated: "Cambio", deleted: "Eliminación" };

/** Texto legible de una acción: el específico si existe, si no «Alta/Cambio/Eliminación: <entidad>». */
export const actionLabel = (a: string) => {
  if (ACTION_LABEL[a]) return ACTION_LABEL[a];
  const [entity, verb] = a.split(".");
  return VERB[verb] && ENTITY_LABEL[entity] ? `${VERB[verb]}: ${ENTITY_LABEL[entity]}` : a;
};
