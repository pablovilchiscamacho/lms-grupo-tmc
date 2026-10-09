# LMS Grupo TMC

Plataforma corporativa de capacitación para Grupo TMC (EA Logística, TMC, TMCa y futuras empresas): usuarios, cursos con presentaciones y videos, exámenes, asignaciones, cumplimiento, constancias con QR, reportes, correo y trazabilidad ISO.

**Estado:** las 10 fases del plan están terminadas y en producción (https://lms-grupo-tmc.vercel.app). Criterios de aceptación y su evidencia: [docs/ACEPTACION.md](docs/ACEPTACION.md).

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres 17 + Auth + Storage + pg_cron + pg_net + Vault, región us-east-1) · Vercel · Resend (correo).

## Estructura
| Carpeta | Contenido |
|---|---|
| `src/app` | Pantallas y rutas: `(auth)` entrada y MFA · `(empleado)` vista del empleado · `admin` administración · `api` descargas (PDF, reportes, archivos) · `verify` verificación pública de constancias |
| `src/features` | Lógica por módulo: users, org, courses, content, learning, exams, attempts, grading, assignments, dashboards, certificates, reports, notifications, traceability |
| `src/lib` | Sesión y permisos, cliente de Supabase, errores, formatos, PDF |
| `supabase/migrations` | **Toda la base de datos** (tablas, RLS, funciones, jobs) en 21 migraciones numeradas |
| `tests/db` | Pruebas de la base con PGlite (permisos, reglas, alcance, respaldo, carga) |
| `scripts` | Migrar, respaldar/restaurar, crear el primer Super Admin, arranque del piloto, ejemplo de presentación |
| `docs` | Propuesta, arquitectura, base de datos, seguridad, despliegue, pruebas, API y guías de uso |
| `ops` | Flujo de respaldo semanal para GitHub Actions |

## Comandos
```bash
npm install
```
```bash
cp .env.example .env.local
```
Llena las variables (ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Después:

| Comando | Para qué |
|---|---|
| `npm run dev` | Servidor local en http://localhost:3000 |
| `npm run db:migrate` | Aplica las migraciones pendientes a la base de Supabase |
| `npm test` | Todas las pruebas (155) |
| `npm run build` | Compilación de producción |
| `npm run db:backup` / `npm run db:restore` | Respaldo cifrado de los datos / restauración |
| `npm run bootstrap:admin` | Crea el primer Super Admin en un proyecto nuevo |
| `npm run email:key` | Guarda la clave de Resend cifrada en Supabase Vault |

## Documentación
- [00-PROPUESTA.md](docs/00-PROPUESTA.md): alcance, decisiones y roadmap
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [DATABASE.md](docs/DATABASE.md) · [SECURITY.md](docs/SECURITY.md)
- [DEPLOYMENT.md](docs/DEPLOYMENT.md): despliegue, respaldos, monitoreo y la mudanza a us-east-1
- [API.md](docs/API.md): funciones del servidor por fase · [TESTING.md](docs/TESTING.md)
- [ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) · [USER_GUIDE.md](docs/USER_GUIDE.md)

## Seguridad
Las claves **nunca** van en el repositorio: viven en `.env.local` (local, ignorado por git), en las variables de Vercel y en Supabase Vault. Toda la autorización ocurre en la base (RLS + funciones con permisos y alcance).
