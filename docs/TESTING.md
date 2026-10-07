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

## Cobertura actual (Fase 1): 39 pruebas

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

## Regla para las fases siguientes
Cada tabla nueva llega con sus pruebas de RLS: qué **puede** y qué **no puede** hacer cada rol, siempre con usuarios de dos empresas distintas. Cada RPC llega con su prueba de permiso negado.
