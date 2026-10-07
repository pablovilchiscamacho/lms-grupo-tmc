# LMS Grupo TMC

Plataforma corporativa de capacitación para Grupo TMC (EA Logística, TMC, TMCa y futuras empresas): usuarios, cursos, exámenes, asignaciones, cumplimiento, certificados y trazabilidad ISO.

**Estado:** Fase 1 (Fundación) terminada. Ver el [roadmap](docs/00-PROPUESTA.md#8-roadmap-de-implementación).

## Stack
Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + Storage + pg_cron) · Vercel.

## Arranque rápido (desarrollo)

```bash
npm install
```
```bash
cp .env.example .env.local
```
Llena las llaves del proyecto de Supabase de desarrollo y sigue [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §1: migraciones, ajustes de Auth y datos demo.
```bash
npm run dev
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm test` | Pruebas (incluye RLS y funciones de la base, sin Docker) |
| `npm run typecheck` · `npm run lint` | Tipos y estilo |
| `npm run build` | Compilación de producción |
| `npm run db:push` | Aplica las migraciones al proyecto de Supabase enlazado |
| `npm run db:types` | Genera los tipos de TypeScript desde la base |
| `npm run seed:demo` | Datos demo (solo desarrollo) |
| `npm run bootstrap:admin -- …` | Crea el primer Super Admin |

## Documentación

| Documento | Contenido |
|---|---|
| [00-PROPUESTA](docs/00-PROPUESTA.md) | Decisiones aprobadas, MVP y roadmap |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Capas, patrones de acceso a datos y carpetas |
| [DATABASE](docs/DATABASE.md) | Modelo de datos y ERD |
| [SECURITY](docs/SECURITY.md) | Roles, permisos y RLS |
| [API](docs/API.md) | Server Actions y RPC |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Puesta en marcha, paso a paso |
| [TESTING](docs/TESTING.md) | Pruebas y cobertura |
| [ADMIN_GUIDE](docs/ADMIN_GUIDE.md) · [USER_GUIDE](docs/USER_GUIDE.md) | Guías de uso |

## Estructura

```
supabase/migrations/   SQL versionado (tablas, RLS, funciones, triggers)
src/app/               Rutas: (auth) entrar…, (empleado) /, admin/…
src/features/<dominio> actions.ts · queries.ts · schemas.ts · componentes
src/lib/               supabase (server/client/admin), auth, errores, formato
tests/db/              Pruebas de base de datos (PGlite)
scripts/               Datos demo y primer administrador
```
