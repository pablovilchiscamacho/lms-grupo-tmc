# SECURITY.md: roles, permisos, RLS e integridad

**Estado:** aprobado el 7-oct-2026; la Fase 1 está implementada y probada (ver TESTING.md). Prioridad del proyecto: **seguridad > integridad de datos > funcionalidad > escalabilidad > UX > estética.**

## 1. Modelo de amenazas (resumen)

| Amenaza | Ejemplo | Defensa principal |
|---|---|---|
| Acceso cruzado entre empresas | Un manager de TMC consulta empleados de EA | RLS con funciones de alcance y pruebas automatizadas por cada tabla |
| Toma de cuentas administrativas | RH cambia el correo de un Super Admin y pide restablecer la contraseña | `app.assert_can_manage_target`: solo quien tiene `roles.assign` puede editar, desactivar o restablecer a alguien con un rol administrativo |
| Escalamiento de privilegios | Un instructor se asigna a sí mismo el rol de admin | `user_roles` solo se modifica vía RPC, que exige `roles.assign` y **nunca** permite asignarse roles a uno mismo ni otorgar permisos que uno no tiene |
| Manipulación académica | Un empleado manda `score=100` o `progress=100` | El empleado **no tiene permiso de escritura** en esas tablas. Todo se calcula en funciones del servidor. |
| Fraude en examen | Leer la respuesta correcta en el JSON, abrir dos pestañas o adelantar el reloj | Las claves viven en un esquema privado, la sesión es única por intento y la hora es `now()` del servidor |
| Robo de archivos | Adivinar la URL de un PDF | El bucket es privado, las rutas son uuid y las URLs firmadas son de corta duración y se emiten tras validar la inscripción |
| XSS | Un instructor pega `<script>` en una lección | Sanitización al guardar (lista blanca) y CSP estricta |
| Fuerza bruta | Probar contraseñas | Límites de Supabase Auth, *rate limit* propio por IP y por identificador, y mensajes genéricos |
| Llaves expuestas | La *service role key* en el cliente | Solo vive en módulos `server-only` y en variables de entorno, y un *lint* falla si se importa desde código cliente |
| Alteración del historial | Un admin borra un intento reprobado | No hay DELETE en las tablas académicas, la anulación queda auditada y la bitácora tiene cadena de hash |

## 2. Catálogo de permisos

| Clave | Descripción |
|---|---|
| `org.read` / `org.manage` | Ver / administrar empresas, sucursales, departamentos y puestos |
| `users.read` | Ver perfiles dentro del alcance |
| `users.create` · `users.update` · `users.deactivate` · `users.import` | Gestión de usuarios |
| `roles.assign` | Asignar o revocar roles |
| `courses.read` | Ver cursos (incluidos borradores) dentro del alcance |
| `courses.create` · `courses.update` | Crear y editar borradores |
| `courses.review` | Aprobar o rechazar lo que está en revisión |
| `courses.publish` · `courses.suspend` · `courses.archive` | Transiciones de estado |
| `courses.delete` | Borrado físico (solo cursos sin inscripciones) |
| `content.upload` | Subir archivos |
| `questions.read` · `questions.write` | Banco de preguntas |
| `exams.write` | Constructor de exámenes |
| `assignments.read` · `assignments.write` | Asignaciones |
| `enrollments.adjust` | Prórrogas, intentos extra, cancelar y reasignar |
| `grading.grade` | Calificar respuestas abiertas |
| `grading.override` | Recalificar respuestas automáticas y anular intentos (exige motivo) |
| `progress.read` | Ver avance y calificaciones de otros |
| `reports.read` · `reports.export` | Reportes |
| `dashboard.executive` | Vista de Dirección |
| `certificates.read` · `certificates.revoke` | Certificados |
| `notifications.manage` | Reglas de recordatorio y plantillas |
| `audit.read` | Bitácora |
| `settings.manage` | Configuración global y por empresa |

**Permisos implícitos de cualquier usuario activo** (no se guardan en la tabla): ver su perfil y editar teléfono y foto, ver sus inscripciones, cursos asignados, avance, intentos, resultados (según la visibilidad), certificados y notificaciones.

## 3. Matriz rol × permiso (valores iniciales, editables como datos)

| Permiso | Super Admin | Admin Capacitación | Admin RH (D5) | Manager | Instructor |
|---|:-:|:-:|:-:|:-:|:-:|
| org.read | ✅ | ✅ | ✅ | ✅ | — |
| org.manage | ✅ | — | — | — | — |
| users.read | ✅ | ✅ | ✅ | ✅ (alcance) | ⚠️ limitado* |
| users.create / update / import | ✅ | — | ✅ | — | — |
| users.deactivate | ✅ | — | ✅ | — | — |
| roles.assign | ✅ | — | — | — | — |
| courses.read | ✅ | ✅ | — | ✅ (publicados) | ✅ (los suyos) |
| courses.create / update | ✅ | ✅ | — | — | ✅ (los suyos, en borrador) |
| courses.review / publish / suspend / archive | ✅ | ✅ | — | — | — |
| courses.delete | ✅ | — | — | — | — |
| content.upload | ✅ | ✅ | — | — | ✅ |
| questions.read / write | ✅ | ✅ | — | — | ✅ |
| exams.write | ✅ | ✅ | — | — | ✅ (los suyos) |
| assignments.read | ✅ | ✅ | ✅ | ✅ | — |
| assignments.write | ✅ | ✅ | — | — | — |
| enrollments.adjust | ✅ | ✅ | — | — | — |
| grading.grade | ✅ | ✅ | — | — | ✅ (sus cursos) |
| grading.override | ✅ | ✅ | — | — | — |
| progress.read | ✅ | ✅ | ✅ | ✅ (alcance) | ✅ (sus cursos) |
| reports.read / export | ✅ | ✅ | ✅ | ✅ (alcance) | — |
| dashboard.executive | ✅ | — | — | — | — |
| certificates.read | ✅ | ✅ | ✅ | ✅ (alcance) | — |
| certificates.revoke | ✅ | — | — | — | — |
| notifications.manage | ✅ | ✅ | — | — | — |
| audit.read | ✅ | — | — | — | — |
| settings.manage | ✅ | — | — | — | — |

\* El instructor solo ve, de los alumnos de *sus* cursos, el nombre, el número de empleado, la empresa, el departamento, el avance y las respuestas (C14). La vista `v_course_learners` le entrega esas columnas y nada más.
La vista de Dirección se puede dar también a directores con un rol `executive` (solo lectura, alcance de grupo o empresa).

## 4. Alcances

Cada rol se otorga **con un alcance** (`user_roles.scope_type` + `scope_id`):

| Alcance | Significado |
|---|---|
| `group` | Todo Grupo TMC (Super Admin y, normalmente, Admin de Capacitación) |
| `company` | Una empresa (por ejemplo, Admin de RH de EA) |
| `branch` | Una sucursal (por ejemplo, gerente de Manzanillo) |
| `department` | Un departamento |
| `team` | Toda la línea de reporte de quien tiene el rol (D4). Usa `profile_hierarchy`. |

Un usuario puede tener varios roles y varios alcances. Los permisos se **suman**. Los instructores reciben alcance **por curso** mediante `course_instructors`.

## 5. Funciones de autorización (base de todas las políticas)

Viven en el esquema `app` (no expuesto), son `stable security definer` y usan `set search_path = ''`. Se evalúa `(select auth.uid())` una sola vez por consulta.

```sql
-- ¿El usuario actual está activo y (si su rol lo exige) entró con MFA?
app.is_active_session() returns boolean

-- ¿Tiene el permiso sobre un sujeto ubicado en (empresa, sucursal, depto, usuario)?
app.can(p_perm text,
        p_company uuid default null, p_branch uuid default null,
        p_department uuid default null, p_subject_user uuid default null) returns boolean
-- Verdadero si existe un user_role vigente cuyo rol incluye p_perm y cuyo alcance es:
--   group | company = p_company | branch = p_branch | department = p_department (o ancestro)
--   | team y p_subject_user es descendiente en profile_hierarchy

-- Atajos
app.can_view_user(p_user uuid)         -- uno mismo, users.read/progress.read en alcance, o instructor de un curso del usuario
app.is_course_instructor(p_course uuid)
app.can_manage_course(p_course uuid, p_perm text)  -- considera owner_company_id (nulo = requiere alcance group)
app.my_enrollment_version_ids()        -- versiones a las que el usuario tiene acceso por inscripción activa
```

**Rendimiento:** para los tableros y reportes no se depende de la evaluación fila por fila. Las RPC calculan una sola vez `app.my_scope_filter('progress.read')`, que devuelve los arreglos de empresas, sucursales, departamentos y subordinados, y filtran con `= ANY(...)` sobre columnas indexadas.

## 6. Políticas RLS por tabla

Todas las tablas de `public` tienen `ENABLE ROW LEVEL SECURITY` y una prueba automatizada impide agregar una tabla sin él. No se usa `FORCE`: las funciones `security definer` corren como `postgres`, que en Supabase tiene `BYPASSRLS`, y ningún rol de la app es dueño de las tablas. Se revocan los privilegios por defecto a `anon` y `public`. Los privilegios de `authenticated` se otorgan tabla por tabla, al mínimo necesario. "RPC" significa que **no hay política de escritura** para `authenticated`: solo funciones `security definer` que validan.

| Tabla | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| companies, branches, departments, positions | La propia empresa, más las empresas dentro de los alcances del usuario | `org.manage` (alcance group). DELETE: nadie (se desactivan). |
| profiles | `id = auth.uid()` **o** `app.can_view_user(id)` | RPC (`app.create_user`, `app.update_user` y `app.set_user_status`). El usuario solo puede actualizar `phone` y `photo_file_id` de sí mismo (privilegio por columna + política). |
| profile_hierarchy | Uno mismo como ancestro o descendiente; admins | Solo triggers |
| roles, permissions, role_permissions | Cualquier usuario autenticado | `settings.manage` (group) |
| user_roles | Los propios; `roles.assign` | RPC `app.grant_role` / `app.revoke_role` (sin auto-asignación y sin otorgar lo que uno no tiene; no se puede quitar al último Super Admin) |
| categories, tags | Autenticados | `courses.update` / `questions.write` |
| files | `content.upload` o `courses.read` en el alcance del curso. Los empleados **no** leen esta tabla: piden una URL firmada a la app. | INSERT vía la acción de subida; UPDATE de estado solo el servidor; DELETE lógico |
| settings | Autenticados (excepto claves marcadas como privadas) | `settings.manage` |
| courses | `courses.read` en alcance, instructor del curso, inscripción activa propia **o** `visibility = catalog` y publicado | INSERT/UPDATE con `app.can_manage_course(id, 'courses.update')`. La columna `status` no se puede actualizar directamente (privilegio por columna): solo `app.transition_course`. DELETE solo vía RPC. |
| course_versions, course_modules, lessons, lesson_contents | Gestores del curso; el empleado solo **la versión fijada en su inscripción** (o la publicada, si es de catálogo) | Gestores del curso **y** versión en `draft` (además del trigger de inmutabilidad) |
| course_instructors, course_prerequisites | Como courses | Gestores del curso |
| exams | Gestores del curso. El empleado lee la vista `v_my_exams` (título, tiempo, intentos usados y restantes, mínimo y número de preguntas), **sin** acceso a `exam_items` ni `exam_pools`. | Gestores del curso y versión en `draft`; columnas operativas en cualquier estado |
| exam_items, exam_pools | Gestores del curso | Como exams |
| questions, question_options, question_tags | `questions.read` en el alcance del banco. **Los empleados nunca.** | `questions.write`; si `is_locked`, solo se puede crear una revisión |
| assignments | `assignments.read` en alcance | RPC `app.create_assignment` (`assignments.write`) |
| enrollments, enrollment_exceptions | Las propias; `progress.read` en el alcance del inscrito; instructor del curso | RPC únicamente |
| lesson_progress | Igual que enrollments | RPC únicamente (`app.track_lesson` y `app.complete_lesson`) |
| exam_attempts | Los propios (columnas de resultado ocultas según `results_visibility`, vía la vista `v_my_attempts`); evaluadores en alcance | RPC únicamente |
| attempt_questions | El propio intento mientras está `in_progress`, o cuando se permite revisar; evaluadores | RPC únicamente |
| **app.attempt_question_keys** | **Nadie** por API. Solo lo leen funciones `security definer` (calificar y revisar con las correctas, si se permite). | Solo `app.start_attempt` |
| attempt_answers | Las propias (sin `auto_points` ni `is_correct` hasta que la visibilidad lo permita); evaluadores | RPC únicamente |
| manual_grades | El propio, solo `feedback` y `score_pct` cuando los resultados son visibles; evaluadores y `progress.read` | RPC `app.grade_answer` |
| attempt_events | Evaluadores y `audit.read` | RPC |
| certificates | Los propios; `certificates.read` en alcance | RPC (emisión automática); `app.revoke_certificate` |
| notifications | `user_id = auth.uid()` | El usuario solo puede actualizar `read_at` de las suyas; INSERT lo hace el sistema |
| reminder_rules | `notifications.manage` | `notifications.manage` |
| email_outbox, rate_limits, import_* | Sin acceso de `authenticated` (solo servidor) o solo el autor del import | Servidor |
| compliance_snapshots | Vía RPC de tableros (filtrada por alcance) | Solo el job |
| **audit.audit_logs** | Vía RPC `app.search_audit()` con `audit.read`, filtrada por alcance | INSERT solo desde triggers y `app.log()`. **UPDATE y DELETE revocados a todos los roles**, `service_role` incluido. |

**Storage (`storage.objects`):** todos los buckets son **privados** y no hay políticas para `authenticated` ni `anon`, así que se niega todo por defecto. La subida usa `createSignedUploadUrl` y la lectura `createSignedUrl`, ambas emitidas por el servidor **después** de validar con las mismas funciones `app.*`.

**Funciones RPC expuestas:** `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM public, anon` (por defecto, en Postgres cualquiera puede ejecutar funciones). Se otorga `EXECUTE` a `authenticated` solo para la lista explícita, y a `anon` únicamente `verify_certificate(code)`.

**Pruebas de RLS:** por cada tabla y cada rol hay un caso que comprueba qué **puede** y qué **no puede** hacer, con usuarios de dos empresas distintas. Si una tabla nueva no tiene pruebas de RLS, CI falla (un script compara el catálogo de tablas con la lista de pruebas).

## 7. Integridad del examen y antifraude (§39 y §43)

| Medida | Implementación |
|---|---|
| Reloj del servidor | `deadline_at` se calcula con `now()` al iniciar. `save_answer` rechaza después de `deadline_at + 30 s` de gracia por latencia. El contador del navegador solo es una visualización. |
| Cierre automático | `pg_cron` cada minuto ejecuta `app.close_expired_attempts()`: entrega con las respuestas guardadas, califica y manda a revisión lo que es manual. |
| Sin intentos duplicados | Índice único parcial con un solo `in_progress` por inscripción y examen, más `SELECT … FOR UPDATE` sobre la inscripción en `start_attempt`. Llamar a `start_attempt` cuando ya hay uno abierto **lo reanuda** y no crea otro. |
| Una sesión por intento | `start_attempt` devuelve un token aleatorio y la base guarda su hash. Cada `save_answer` lo exige. Si se abre el intento en otro dispositivo, el usuario elige "continuar aquí": el token anterior queda inválido y se registra el evento `session_takeover`, visible para el evaluador. |
| Claves ocultas | El navegador recibe solo `attempt_questions.snapshot`, sin respuestas. Las claves están en `app.attempt_question_keys`, que no se expone. |
| Aleatorización | Selección del *pool* y orden de preguntas y opciones con una semilla guardada en el intento, lo que lo hace reproducible ante una auditoría |
| Validación de respuestas | `save_answer` verifica que los ids enviados pertenezcan a la copia congelada de esa pregunta, que el formato corresponda al tipo y que el tamaño sea razonable (texto ≤ 10 000 caracteres) |
| Intentos y enfriamiento | Se validan en `start_attempt`: intentos usados (incluidos los anulados por el usuario) contra `max_attempts` + `extra_attempts` otorgados, y espera mínima entre intentos |
| Señales | Pérdida de foco, salida de pantalla completa y toma de sesión quedan en `attempt_events`. **Informan, no bloquean**: un falso positivo no debe reprobar a nadie. |
| Recuperación | Al recargar la página o volver a entrar, se reanuda el intento abierto con sus respuestas guardadas. El reloj **no se detiene** (así lo indica la advertencia previa al examen). |

## 8. Autenticación

- **Supabase Auth** con correo y contraseña. El formulario acepta un correo **o** un número de empleado o usuario: el servidor resuelve el `auth_email` internamente (D1) y responde siempre con el mismo mensaje genérico ("Usuario o contraseña incorrectos").
- **Alta:** el admin crea el usuario y, si tiene correo real, se le envía una invitación con un enlace para definir su contraseña (**nunca** se envían contraseñas). Si no tiene correo, el admin genera una contraseña temporal que se muestra **una sola vez** en pantalla, con `must_change_password = true`.
- **Recuperación:** "Olvidé mi contraseña" envía un enlace de un solo uso con vigencia de 1 hora. Si la cuenta no tiene correo real, el mensaje indica acudir con su administrador. Para no revelar qué cuentas existen, la respuesta es la misma en todos los casos.
- **Contraseñas:** mínimo 10 caracteres y protección contra contraseñas filtradas (HaveIBeenPwned, función de Supabase Pro).
- **MFA (TOTP)** obligatorio para los roles administrativos. Las funciones `app.can()` exigen `aal2` cuando el rol lo requiere, así que sin el segundo factor no hay permisos administrativos, aunque la sesión exista.
- **Sesión:** cookies `httpOnly`, `Secure` y `SameSite=Lax` (`@supabase/ssr`), con el *access token* de 1 h y rotación del *refresh token*. Al desactivar a un usuario se banea en Auth y `app.is_active_session()` lo bloquea de inmediato, sin esperar a que caduque el token.
- **Login y logout** quedan en la bitácora (`auth.login`, `auth.logout` y `auth.login_failed`, este último sin la contraseña) y actualizan `last_login_at`.

## 9. Seguridad de la aplicación

| Tema | Medida |
|---|---|
| Validación | Zod en **cada** Server Action y Route Handler, además de CHECK y FK en la base. Nunca se confía en ids, montos ni estados que mande el cliente. |
| CSRF | Server Actions de Next.js (verifican `Origin` contra `Host`), cookies `SameSite=Lax` y Route Handlers mutantes que solo aceptan POST con verificación de origen |
| XSS | Texto enriquecido sanitizado al **guardar** (lista blanca de etiquetas y atributos, sin `style` ni `on*`) y de nuevo al renderizar. React escapa todo lo demás. Nada de `dangerouslySetInnerHTML` sin sanitizar (regla de *lint*). |
| CSP | `default-src 'self'`; `img-src`/`media-src` para el dominio de Storage; `frame-ancestors 'none'`; `object-src 'none'`; *nonces* para scripts |
| Encabezados | HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y `Permissions-Policy` restrictiva |
| Archivos | Lista blanca de extensiones (pdf, ppt, pptx, doc, docx, xls, xlsx, mp4, jpg, jpeg, png, más webp y csv solo para importar), **sin** macros (pptm, docm, xlsm), SVG, HTML ni ejecutables. Se verifica el tipo real por *magic bytes* después de subir; si no coincide, se marca `rejected` y se borra. Tamaño máximo configurable: 50 MB para documentos y 1 GB para video. El nombre en Storage es un uuid generado por el servidor. |
| Rate limiting | Login: 5 intentos/min por identificador y 20/min por IP. Verificación pública: 30/min por IP. Exportaciones: 10/min por usuario. Tabla `rate_limits` con una función atómica, además de los límites de Supabase Auth y reglas WAF de Vercel. |
| Secretos | Solo en variables de entorno. `SUPABASE_SERVICE_ROLE_KEY` se usa únicamente en `src/lib/supabase/admin.ts` (`import 'server-only'`). `.env*` está en `.gitignore`. Los jobs exigen `JOBS_SECRET` (comparación en tiempo constante). |
| Errores | El usuario nunca ve errores técnicos. Un mapa traduce cada código (por ejemplo, `23505` sobre `profiles_email_key` se muestra como "Este correo ya está registrado"), y el detalle técnico va a los logs con un `request_id` que el usuario puede reportar. |
| Dependencias | `npm audit` en CI, Dependabot y versiones fijadas |

## 10. Privacidad (LFPDPPP)

- Aviso de privacidad para empleados (texto a cargo de RH o Legal), enlazado en el login y en el perfil.
- Minimización de datos: no se pide la CURP (no se usa la DC-3, D8). El RFC es solo de la empresa. La foto es opcional.
- Las fotos están en un bucket privado y se muestran mediante URL firmada.
- **Derechos ARCO:** la cancelación de datos de un exempleado se resuelve con **anonimización** del perfil (nombre → "Exempleado #id", contacto borrado), conservando los registros académicos que la empresa deba retener para la STPS o ISO. Queda documentado como procedimiento.
- La verificación pública de certificados muestra solo nombre, curso, fechas, estado y empresa: ni correo ni número de empleado.

## 11. Respaldos y continuidad

- Supabase Pro: respaldo diario con 7 días de retención (PITR opcional como complemento).
- Volcado lógico **semanal** (`pg_dump`) a un almacenamiento externo vía GitHub Actions, cifrado y con retención de 12 meses, como evidencia ISO.
- Prueba de restauración trimestral documentada.
- Los archivos de Storage se respaldan con un job mensual de sincronización a almacenamiento externo (1.1).

## 12. Endurecimiento (Fase 10)

- **Funciones de la API:** Postgres otorga `EXECUTE` a `PUBLIC` por omisión. La migración 0020 lo quita en todas las funciones de `public` (sin sesión solo existe `verify_certificate`) y cambia los privilegios por omisión del rol de migraciones, así que **toda función nueva nace cerrada**: cada migración debe otorgar `EXECUTE` a `authenticated` en sus RPC y en las funciones de `app` que se usen directamente en políticas RLS (las que se llaman desde otra función `security definer` no lo necesitan).
- `pg_net` solo lo usa la base (el envío de correo corre como dueño); se quitó a `anon` y `authenticated`.
- **Invariantes automáticos** (`tests/db/phase10.test.ts`): todas las tablas con RLS; `anon` sin acceso a tablas; solo `verify_certificate` para `anon`; funciones internas cerradas; toda `security definer` con `search_path`; bitácora y tablas académicas sin escritura directa.
- **Encabezados**: CSP, HSTS con *preload*, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` y `Permissions-Policy` (verificados en producción). `script-src` usa `'unsafe-inline'` por Next.js; pasar a *nonces* queda para la 1.1.
- **Dependencias**: `npm audit --omit=dev` sin vulnerabilidades (se fijó `uuid@11` para `exceljs`). La alerta de `braces` es solo de herramientas de desarrollo y no llega al sitio.

