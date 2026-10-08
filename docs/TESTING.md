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

## Cobertura actual: 109 pruebas (Fase 1: 39 · Fase 2: 23 · Fase 3: 19 + 2 del importador · Fase 4: 13 · Fase 5: 13) + prueba de carga

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

## Regla para las fases siguientes
Cada tabla nueva llega con sus pruebas de RLS: qué **puede** y qué **no puede** hacer cada rol, siempre con usuarios de dos empresas distintas. Cada RPC llega con su prueba de permiso negado.
