# TESTING.md: pruebas

## Cómo correrlas

```bash
npm test
```

| Suite | Qué cubre | Herramienta |
|---|---|---|
| `tests/db/*.test.ts` | Migraciones, RLS, funciones RPC, triggers y bitácora | Vitest + **PGlite** (Postgres embebido) con un *shim* mínimo de Supabase (`tests/db/supabase-shim.sql`) |
| `npm run typecheck`, `npm run lint` | Tipos y reglas de código | TypeScript, ESLint |
| E2E (Fase 10) | Flujos completos en el navegador contra el proyecto de desarrollo | Playwright |

Las pruebas de base de datos no necesitan Docker ni internet: cada archivo crea una base nueva en memoria, aplica **todas** las migraciones reales y simula el JWT de cada usuario como lo hace PostgREST (`set local role authenticated` + `request.jwt.claims`). Una corrida completa tarda alrededor de 1 segundo.

### Límites del *shim*
- `auth.users` es una tabla mínima. Supabase Auth (contraseñas, MFA, correos) se prueba en desarrollo y en E2E.
- `pg_cron` no existe en PGlite: la migración de jobs se salta y las funciones (`audit.seal()`) se prueban llamándolas directamente.
- PGlite es Postgres 18 y Supabase usa 15 o 17, así que las migraciones evitan la sintaxis exclusiva de versiones nuevas.

## Cobertura actual: 142 pruebas (Fase 1: 39 · Fase 2: 23 · Fase 3: 19 + 2 del importador · Fase 4: 13 · Fase 5: 13 · Fase 6: 7 · Fase 7: 9 + 2 de fechas · Fase 8: 9 · Fase 9: 5 + 1 de PDF) + prueba de carga

| Área (§65) | Pruebas |
|---|---|
| **RLS habilitado** | Ninguna tabla de `public` queda sin RLS (la prueba falla si se agrega una sin políticas) |
| **Anónimos** | `anon` no puede leer ninguna tabla |
| **Multiempresa** | Un empleado de TMC solo ve su perfil y su empresa. RH de EA ve a todo EA y a nadie de TMC, no puede crear usuarios en TMC ni mover a alguien de EA a TMC |
| **Alcances** | Manager por línea de reporte (directos e indirectos), manager por sucursal y Super Admin |
| **MFA** | Un rol administrativo sin `aal2` no tiene permisos |
| **Escrituras** | Nadie (ni el Super Admin) escribe perfiles directamente: solo vía RPC. Un empleado no puede darse roles |
| **Cuentas protegidas** | RH no puede editar, desactivar ni restablecer a un administrador (evita tomar su cuenta) |
| **Integridad** | Sucursal de otra empresa (trigger), ciclos en la jerarquía de personas y de departamentos, recálculo de la jerarquía, último Super Admin |
| **Estados** | Desactivar quita los permisos de inmediato. La baja lógica conserva el registro |
| **Login** | Resolución por correo, usuario o número de empleado; número ambiguo entre empresas; `resolve_login` solo para el servidor; *rate limit* |
| **Importación** | Válidos, errores, duplicados (en el archivo y en la base) y permisos por empresa |
| **Bitácora** | Autoría correcta, cadena de hash verificable, inmutable (UPDATE/DELETE rechazados), sin acceso por API y consulta filtrada por alcance |

### Fase 2 (`tests/db/phase2.test.ts`)

| Área | Pruebas |
|---|---|
| **Cursos** | Crear con versión 1 en borrador; RH sin permiso no crea ni ve cursos; el reporte de publicación detecta módulos y lecciones vacíos |
| **Inmutabilidad** | Tras publicar no se pueden editar lecciones, contenidos ni reglas de esa versión (`VERSION_LOCKED`); la máquina de estados rechaza transiciones inválidas |
| **Versionado (§31)** | La versión 2 es una copia que reutiliza los mismos archivos; quien ya empezó sigue en la versión 1 y quien no, toma la 2 |
| **Asignación** | Asignación directa, sin duplicados; RH sin permiso de asignar no puede |
| **Visibilidad** | Solo el inscrito ve el curso y sus lecciones; el jefe ve el avance de su equipo y no el de otra empresa |
| **Avance** | Orden obligatorio; el botón valida la regla en el servidor; el tiempo lo cuenta el servidor (máx. 60 s por latido); el % de video se acota al tiempo real; las páginas del PDF no se pueden marcar todas de golpe |
| **Integridad** | El empleado no puede escribir su avance; nadie puede borrar inscripciones |
| **Archivos** | Tipos y tamaños permitidos; deduplicación por huella; solo quien gestiona el curso o está inscrito abre un archivo; los pasos de servidor no se pueden llamar desde la app |
| **Estados** | Un curso suspendido no se puede tomar; no se borra un curso con historial; duplicar copia todo el contenido |

Además se probó contra el proyecto real de Supabase la subida directa a Storage, la verificación del tipo real, el conteo de páginas y que el bucket no se pueda leer sin URL firmada.

### Fase 3 (`tests/db/phase3.test.ts` y `src/features/exams/import-parse.test.ts`)

| Área | Pruebas |
|---|---|
| **Banco** | Validación por tipo; el empleado no puede leer preguntas ni opciones; editar una pregunta ya publicada crea una revisión y el examen publicado conserva la original |
| **Presentar** | No se presenta sin terminar el contenido; las preguntas llegan sin respuestas correctas; las claves y los intentos no se pueden leer por la API |
| **Sesión** | Volver a entrar reanuda el mismo intento; otro dispositivo toma el control y el anterior ya no puede guardar (`SESSION_CONFLICT`) |
| **Respuestas** | Se rechazan ids que no son de la pregunta |
| **Calificación** | Los 8 tipos: parcial en selección múltiple (resta errores), respuesta corta sin acentos ni mayúsculas, ordenar, relacionar, escala sin puntos; la abierta queda en revisión y bloquea un nuevo intento |
| **Revisión manual** | Bandeja; el empleado no se califica a sí mismo; RH sin permiso no califica; recalificar una automática exige motivo y queda marcada |
| **Política** | Con la mejor calificación, el segundo intento aprueba el curso |
| **Tiempo** | Con el tiempo vencido no se guarda y el intento se cierra solo; el job cierra los intentos abandonados |
| **Intentos** | Al agotarlos sin aprobar, el curso queda reprobado; un intento anulado no cuenta |
| **Versiones** | La versión nueva copia el examen; el publicado no se edita (solo activar o pausar) |
| **Importador** | La plantilla oficial produce los 8 tipos sin errores; las filas con error se reportan |

Se probó en vivo contra Supabase: examen con los 8 tipos, entrega, calificación automática (77.78 % preliminar), revisión en la bandeja y aprobación final (100 %).

### Fase 4 (`tests/db/phase4.test.ts`)

| Área | Pruebas |
|---|---|
| **Crear** | La vista previa cuenta solo a personas activas que cumplen el filtro; asignar por área con fecha relativa y para usuarios futuros; RH sin `assignments.create` no puede asignar |
| **Reglas vivas** | Quien entra después al área recibe el curso solo; una asignación desactivada deja de inscribir |
| **Cambios de persona** | Al cambiar de área o darse de baja se cancela lo no iniciado; lo iniciado se conserva |
| **Excepciones** | Prórroga (cambia la fecha y avisa); intento extra tras reprobar; reasignar abre un ciclo nuevo y conserva el anterior |
| **Recapacitación y vigencia** | Publicar con «requiere recapacitación» abre un ciclo para quien ya aprobó; el job diario renueva lo que está por vencer y manda recordatorios |
| **Avisos** | Cada quien ve solo los suyos y solo puede marcarlos como leídos |

Se probó en vivo contra Supabase: asignación por regla a EA · Ventas (2 personas), alta de una persona nueva en Ventas que recibió el curso automáticamente, prórroga desde su ficha y el aviso con contador en el menú del empleado.

### Fase 5 (`tests/db/phase5.test.ts`)

| Área | Pruebas |
|---|---|
| **Alcance** | Super Admin ve el grupo; RH de EA no ve TMC; el jefe ve su línea de reporte (directos e indirectos) y no a sí mismo; un jefe de sucursal ve a quien no tiene cursos; un empleado sin `progress.read` recibe `FORBIDDEN` |
| **Por persona** | Semáforo verde, rojo y sin cursos; filtros de vencidos, por vencer, reprobados, departamento, jefe, búsqueda sin acentos y curso; orden peor y mejor primero |
| **Ranking y actividad** | Departamentos ordenados por cumplimiento; cursos con % de reprobación; la actividad respeta el alcance |
| **Evolución** | La foto diaria alimenta la gráfica mensual filtrada por alcance; la tabla no se puede leer directo |

### Prueba de carga (`tests/db/load.test.ts`)
`LOAD=1 npx vitest run tests/db/load.test.ts` crea 5 000 personas y 100 000 inscripciones sintéticas y mide cada consulta. Resultado en PGlite (más lento que Supabase): todas entre 2 y 160 ms; la meta de la Fase 5 era menos de 1 s.

Se probó en vivo contra Supabase: inicio del administrador con «Requiere atención» y actividad, Cumplimiento por persona y por departamento, Dirección con evolución mensual, y la vista de un jefe limitada a su equipo.

### Fase 6 (`tests/db/phase6.test.ts`)

| Área | Pruebas |
|---|---|
| **Emisión** | Al terminar se emite sola con folio consecutivo, código de 16 caracteres, vigencia y aviso; no se emite si el curso no da constancia; no se duplica |
| **Integridad** | Nadie (ni el Super Admin) inserta, cambia o borra constancias por la API; `attach_certificate_pdf` solo para el servidor |
| **Lectura** | Cada quien ve las suyas; RH las de su empresa |
| **Verificación** | Sin sesión, con guiones o minúsculas; solo datos mínimos (sin correo ni número de empleado); código inexistente → nada |
| **Revocación** | Solo con `certificates.revoke` y motivo; se verifica como revocada; queda en la bitácora; la vigencia vencida se verifica como expirada |

Se probó en vivo: las 2 constancias de lo ya aprobado se emitieron al aplicar la migración, el PDF se generó y se revisó visualmente, y la verificación pública funciona sin sesión.

### Fase 7 (`tests/db/phase7.test.ts`)

| Área | Pruebas |
|---|---|
| **Reportes** | Los 10 responden; vencidos, reprobados, calificaciones, certificados y cursos traen a las personas y cifras correctas; la paginación no repite ni pierde filas; la actividad registra cada tipo de evento |
| **Alcance** | RH de EA no ve a TMC en **ninguno** de los 10 reportes; el jefe solo ve su línea de reporte; un empleado no consulta ni exporta |
| **Exportación** | Cada exportación queda en la bitácora con filtros y filas; formato inválido → `VALIDATION` |
| **Expediente** | Lo ven el jefe, RH en su empresa y la propia persona; un compañero o RH de otra empresa no |

`src/lib/format.test.ts`: una fecha sin hora (ingreso) ya no se recorre un día por la zona horaria.

La prueba de carga incluye los reportes: cumplimiento, vencidos, cursos y horas entre 140 y 310 ms; actividad (9 tipos de evento sobre 100 000 inscripciones) 770 ms.

### Fase 8 (`tests/db/phase8.test.ts`)
El *shim* simula Vault (`vault.decrypted_secrets`) y `pg_net` (`net.http_post` guarda la petición; la prueba escribe la respuesta en `net._http_response`).

| Área | Pruebas |
|---|---|
| **Encolado** | Apagado no encola; encendido encola solo a quien tiene correo real y solo los tipos encendidos |
| **Plantilla** | Escapa HTML y lleva el enlace correcto |
| **Envío** | Sin clave no manda; con clave manda un lote a Resend con la clave en el encabezado; respuesta 200 → enviados con su id; 422/500 → reintento individual con espera y, tras 4 intentos, fallido |
| **Avisos nuevos** | Examen en revisión avisa a quien califica; recordatorios configurables; resumen del jefe una sola vez por semana y solo a quien tiene permiso de seguimiento |
| **Permisos** | Empleado y RH no ven ni cambian la configuración ni mandan pruebas; el estado nunca expone la clave |

### Fase 9 (`tests/db/phase9.test.ts`)

| Área | Pruebas |
|---|---|
| **§59 completo** | Con un examen real (verdadero/falso + abierta calificada a mano), una sola consulta responde quién creó, versión, quién asignó, qué respondió, quién calificó, calificación final (95 %), aprobación y constancia |
| **Alcance** | El jefe ve la trazabilidad de su equipo **sin** respuestas correctas; el empleado y RH de otra empresa no |
| **Historial del curso** | Versiones con quién publicó, qué cambió y cuántos la tomaron; la bitácora incluye curso, versiones, lecciones, examen, preguntas y asignaciones |
| **Versionado (§31)** | Al publicar v2, el historial de Juan sigue diciendo «v1 — Aprobado» |
| **Integridad** | La cadena se verifica; si alguien altera un registro directamente en la base, la verificación señala exactamente cuál |

Se probó en vivo contra Supabase: la cadena de producción (212 registros) está íntegra; trazabilidad de Ana con sus 6 respuestas, la abierta calificada por Sofía, y el PDF de evidencia revisado visualmente.

## Regla para las fases siguientes
Cada tabla nueva llega con sus pruebas de RLS: qué **puede** y qué **no puede** hacer cada rol, siempre con usuarios de dos empresas distintas. Cada RPC llega con su prueba de permiso negado.
