# API.md: funciones del servidor

La app no expone una API REST propia. Las pantallas usan **Server Actions** (validadas con Zod), que llaman **funciones RPC de Postgres** (`public.*`). Cada RPC vuelve a validar los permisos adentro, así que llamarla directamente con la llave pública no evita ninguna regla.

Convenciones:
- **Permiso**: lo que verifica la función (`app.can`, con el alcance del sujeto).
- **Errores**: códigos de `app.fail(...)`, que `src/lib/errors.ts` traduce a mensajes en español.
- **Bitácora**: evento que queda en `audit.audit_logs`.

## Fase 1

### Sesión y autenticación

| Server Action | RPC / Auth | Permiso | Errores | Bitácora |
|---|---|---|---|---|
| `signIn(identifier, password)` | `resolve_login` (solo service role), `hit_rate_limit`, `auth.signInWithPassword` | público | `AUTH` (mensaje genérico), `RATE_LIMITED` | `auth.login`, `auth.login_failed` |
| `signOut()` · `GET /salir` | `log_session_event` | sesión | — | `auth.logout` |
| `requestPasswordReset(email)` | `resolve_login`, `auth.resetPasswordForEmail` | público, 5 cada 5 min por IP | `RATE_LIMITED` | — |
| `setPassword(password, confirm)` | `auth.updateUser`, `server_mark_user('password_changed')` | sesión | `VALIDATION` | `auth.password_changed` |
| `logMfa(kind)` | `log_session_event` | sesión | — | `auth.mfa_enrolled` / `auth.mfa_verified` |
| — | `my_context()` | sesión | — | — |

`GET /auth/confirm?token_hash&type&next`: canjea los enlaces de invitación y recuperación (`verifyOtp`) y redirige solo a rutas internas.

### Usuarios

| Server Action | RPC | Permiso | Errores | Bitácora |
|---|---|---|---|---|
| `createUser(form)` | `admin_validate_user` → Auth (`inviteUserByEmail` o `createUser`) → `admin_create_user` | `users.create` en la empresa, sucursal y departamento destino | `VALIDATION` (por campo), `FORBIDDEN`. Si el perfil falla, se borra el usuario de Auth (compensación) | `user.created`, `user.invited` |
| `updateUser(id, form)` | `admin_validate_user`, `admin_check_user_action`, Auth (si cambia el correo), `admin_update_user` | `users.update` en la ubicación actual **y** en la nueva; cuentas administrativas solo con `roles.assign` | `VALIDATION`, `FORBIDDEN`, `HIERARCHY_CYCLE`, `ORG_MISMATCH` | `user.updated` (diferencias) |
| `setUserStatus(id, status, reason)` | `admin_set_user_status` + bloqueo en Auth | `users.deactivate` | `CANNOT_CHANGE_SELF`, `LAST_SUPER_ADMIN`, `USER_DELETED` | `user.updated`, `user.ban_changed` |
| `resetUserPassword(id, link\|temp)` | `admin_check_user_action` + Auth | `users.update`; administradores solo con `roles.assign` | `FORBIDDEN` | `user.password_reset` |
| `grantRole(id, rol, alcance, ámbito, vence)` | `admin_grant_role` | `roles.assign` (grupo); no a uno mismo; no otorgar permisos que uno no tiene | `ROLE_ALREADY_ASSIGNED`, `INVALID_SCOPE` | `user_role.created` |
| `revokeRole(id, userRoleId)` | `admin_revoke_role` | `roles.assign` | `LAST_SUPER_ADMIN`, `CANNOT_CHANGE_SELF` | `user_role.updated` |
| `searchPeople(q)` | `select` sobre `profiles` (RLS) | `users.read` | — | — |
| `updateMyPhone(phone)` | `update_my_phone` | el propio usuario | `VALIDATION` | `user.updated` |

### Importación masiva

| Server Action | RPC | Notas |
|---|---|---|
| `previewImport(file)` | `admin_validate_import(rows)` | .xlsx o .csv de hasta 5 MB y 2,000 filas. Resuelve empresa, sucursal, departamento y puesto por clave o nombre, sin distinguir acentos. Clasifica cada fila como `valid`, `error` o `duplicate`. **No escribe nada.** |
| `revalidateImport(rows)` | `admin_validate_import` | Después de corregir en pantalla |
| `importBatch(rows ≤ 25, mode)` | Auth + `admin_create_user` (`via_import`) | Cada fila se revalida en la base. Un fallo en una fila no detiene las demás. Bitácora: `user.imported` y `user.created` por fila |
| `linkImportedManagers(links)` | `admin_link_managers` | Liga jefes que venían en el mismo archivo (por número de empleado o correo) |

### Organización

| Server Action | Tabla (RLS) | Permiso |
|---|---|---|
| `saveOrgItem(tabla, id?, form)` | `companies`, `branches`, `departments`, `positions` | `org.manage` (empresas: alcance de grupo). Triggers: coherencia de empresa y anti-ciclos. Bitácora automática |
| `setOrgItemActive(tabla, id, activo)` | ídem | ídem. **No hay borrado**: se desactiva |

### Bitácora

| RPC | Permiso | Notas |
|---|---|---|
| `search_audit(entidad, id, actor, acción, desde, hasta, antes_de_id, límite)` | `audit.read`; alcance de grupo para todo o de empresa para lo suyo | Paginación *keyset* (`antes_de_id`), máximo 200 por página |
| `audit.verify_chain()` | Solo servidor y SQL | Devuelve el primer id alterado, o `null` si la cadena está íntegra |

### Solo servidor (service role)

`resolve_login`, `hit_rate_limit`, `server_log`, `server_mark_user`. No se pueden ejecutar con la llave pública ni con la sesión de un usuario (lo verifican las pruebas).

### Rutas HTTP

| Ruta | Uso |
|---|---|
| `GET /api/health` | `{ ok, version, entorno }` para monitoreo |
| `GET /auth/confirm` | Enlaces de correo de Supabase Auth |
| `GET /salir` | Cerrar sesión |

## Fase 2: cursos

### Cursos (`src/features/courses/actions.ts`)

| Server Action | RPC / tabla | Permiso | Errores |
|---|---|---|---|
| `createCourse(form)` | `create_course` (crea la versión 1 en borrador y un módulo) | `courses.create` en la empresa dueña (grupo si es de todo el grupo) | `courses_code_key` |
| `updateCourse(id, form)` | `courses` (RLS, columnas permitidas) | `courses.update` | — |
| `updateVersionSettings(...)` | `course_versions` (solo en borrador; trigger) | `courses.update` | `VERSION_LOCKED` |
| `getPublishIssues(versionId)` | `version_publish_issues` | `courses.read` | — |
| `publishCourse(id, resumen, recapacitación)` | `publish_course_version` (retira la versión anterior en la misma transacción) | `courses.publish` | `PUBLISH_BLOCKED`, `REVIEW_REQUIRED` |
| `startNewVersion(id)` | `create_draft_version` (copia profunda; los archivos se reutilizan) | `courses.update` | `COURSE_ARCHIVED` |
| `setCourseStatus(id, estado)` | `set_course_status` (máquina de estados) | según la transición | `INVALID_TRANSITION` |
| `duplicateCourse(id, clave, nombre)` | `duplicate_course` | `courses.read` + `courses.create` | — |
| `deleteCourse(id)` | `delete_course` (solo sin inscripciones) | `courses.delete` | `COURSE_HAS_HISTORY` |
| `previewAudience` / `enrollAudience(id, filtro, fecha)` | `profiles` (RLS) → `admin_enroll` | `assignments.write` por persona | — |
| `cancelEnrollment(...)` | `cancel_enrollment` | `enrollments.adjust` | — |

### Contenido y archivos (`src/features/content/actions.ts`)

| Server Action | Qué hace |
|---|---|
| `prepareUpload({courseId, name, size, sha256, durationS})` | `file_prepare_upload`: valida tipo y tamaño (configurable en `uploads.limits`) y deduplica por huella. Devuelve una URL firmada para subir **directo a Storage**. |
| `finalizeUpload(fileId)` | Lee los primeros bytes y verifica el tipo real (*magic bytes*); si no coincide, borra el objeto. Cuenta las páginas del PDF y arranca la conversión a PDF (CloudConvert) si aplica. Llama a `file_finalize` (solo service role). |
| `pollConversion(fileId)` | Consulta CloudConvert; al terminar guarda el PDF, lo registra con `file_conversion_update` y lo liga a las lecciones en borrador. |
| `addModule` · `updateModule` · `deleteModule` | `course_modules` (RLS + trigger de inmutabilidad) |
| `addTextLesson` · `addLinkLesson` · `addLessonFromFile` · `updateLesson` · `deleteLesson` | `lessons` + `lesson_contents`. Al crear desde un archivo, la regla de completado depende del tipo: PDF/presentación → todas las páginas, video → % visto, imagen → al abrir, Excel → botón. |
| `saveTextContent(id, html)` | Sanitiza el HTML (lista blanca) antes de guardar |
| `attachPdf(contentId, pdfFileId)` | Liga a mano el PDF de una presentación o documento |
| `reorder(kind, ids)` | `reorder_items` (arrastrar y soltar) |

`GET /api/files/[id]` (`?dl=1` para descargar): `file_access` autoriza (gestión del curso o inscripción) y redirige a una URL firmada de 10 min (4 h para video).

### Alumno (`src/features/learning/actions.ts`)

| Server Action | RPC | Reglas en el servidor |
|---|---|---|
| `trackLesson(lessonId, "open" \| "heartbeat", {pages, video_pct, resume})` | `track_lesson` | Inicia el curso y fija la versión; valida inscripción, estado, fechas, prerrequisitos y orden. Suma como máximo 60 s por latido; acota el % de video al tiempo real; acepta pocas páginas nuevas por latido (~2 s por página). Completa sola la lección si se cumple su regla. |
| `completeLesson(lessonId)` | `complete_lesson` | `LESSON_RULE_NOT_MET` si no se cumple la regla |
