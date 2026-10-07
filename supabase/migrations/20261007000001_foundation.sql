-- =====================================================================
-- 0001 · Fundación: esquemas, extensiones, utilidades y tipos base
-- =====================================================================

create schema if not exists extensions;
create schema if not exists app;    -- funciones internas y tablas privadas (no expuestas por la API)
create schema if not exists audit;  -- bitácora (no expuesta por la API)

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Nadie fuera del servidor debe ver estos esquemas directamente.
revoke all on schema app from public, anon, authenticated;
revoke all on schema audit from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;   -- necesario para que las políticas RLS invoquen app.*
grant usage on schema audit to service_role;

-- Por defecto Postgres permite a cualquiera ejecutar funciones nuevas: se revoca y se otorga caso por caso.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;
alter default privileges in schema audit revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------

-- unaccent no es IMMUTABLE; este envoltorio permite usarlo en columnas generadas e índices.
create or replace function app.unaccent_i(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')) $$;

-- Normaliza texto para búsqueda: minúsculas y sin acentos.
create or replace function app.norm(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select lower(app.unaccent_i(trim(p))) $$;

create or replace function app.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Lanza un error de negocio con código propio. La app lo traduce a un mensaje en español (src/lib/errors.ts).
create or replace function app.fail(p_code text, p_detail text default null)
returns void language plpgsql set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end $$;

-- Actor de la petición actual: el que fija explícitamente una RPC (operaciones de servidor) o el usuario del JWT.
create or replace function app.actor_id()
returns uuid language sql stable set search_path = ''
as $$
  select coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid())
$$;

-- Encabezado de la petición (PostgREST expone request.headers). Se usa para IP, user agent y request_id.
create or replace function app.request_header(p_name text)
returns text language sql stable set search_path = ''
as $$
  select nullif(current_setting('request.headers', true), '')::json ->> p_name
$$;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.user_status as enum ('active', 'inactive', 'suspended', 'deleted');
create type public.scope_type  as enum ('group', 'company', 'branch', 'department', 'team');
create type public.file_status as enum ('pending_upload', 'verified', 'rejected');
