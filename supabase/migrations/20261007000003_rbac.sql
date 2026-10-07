-- =====================================================================
-- 0003 · Roles, permisos y alcances (RBAC)
-- =====================================================================

create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (key ~ '^[a-z_]{3,40}$'),
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  requires_mfa boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.permissions (
  key         text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  category    text not null,
  description text not null
);

create table public.role_permissions (
  role_id        uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete restrict,
  role_id     uuid not null references public.roles (id) on delete restrict,
  scope_type  public.scope_type not null,
  scope_id    uuid,
  granted_by  uuid references public.profiles (id),
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles (id),
  constraint user_roles_scope_id_presence check ((scope_type in ('group', 'team')) = (scope_id is null))
);
create unique index user_roles_active_key on public.user_roles
  (user_id, role_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'))
  where revoked_at is null;
create index user_roles_user_active_idx on public.user_roles (user_id) where revoked_at is null;

-- El scope_id debe apuntar a una entidad existente del tipo indicado.
create or replace function app.check_role_scope()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.scope_type = 'company'    and not exists (select 1 from public.companies   where id = new.scope_id))
  or (new.scope_type = 'branch'     and not exists (select 1 from public.branches    where id = new.scope_id))
  or (new.scope_type = 'department' and not exists (select 1 from public.departments where id = new.scope_id)) then
    perform app.fail('INVALID_SCOPE');
  end if;
  return new;
end $$;
create trigger user_roles_scope_check before insert or update of scope_type, scope_id
  on public.user_roles for each row execute function app.check_role_scope();

-- ---------------------------------------------------------------------
-- Catálogo de permisos (SECURITY.md §2)
-- ---------------------------------------------------------------------
insert into public.permissions (key, category, description) values
  ('org.read',              'Organización', 'Ver empresas, sucursales, departamentos y puestos'),
  ('org.manage',            'Organización', 'Administrar empresas, sucursales, departamentos y puestos'),
  ('users.read',            'Usuarios',     'Ver perfiles dentro del alcance'),
  ('users.create',          'Usuarios',     'Dar de alta usuarios'),
  ('users.update',          'Usuarios',     'Editar usuarios'),
  ('users.deactivate',      'Usuarios',     'Desactivar, suspender o dar de baja usuarios'),
  ('users.import',          'Usuarios',     'Importar usuarios desde CSV/Excel'),
  ('roles.assign',          'Usuarios',     'Asignar y revocar roles'),
  ('courses.read',          'Cursos',       'Ver cursos (incluye borradores) dentro del alcance'),
  ('courses.create',        'Cursos',       'Crear cursos'),
  ('courses.update',        'Cursos',       'Editar borradores de cursos'),
  ('courses.review',        'Cursos',       'Aprobar o rechazar cursos en revisión'),
  ('courses.publish',       'Cursos',       'Publicar cursos'),
  ('courses.suspend',       'Cursos',       'Suspender y reactivar cursos'),
  ('courses.archive',       'Cursos',       'Archivar cursos'),
  ('courses.delete',        'Cursos',       'Borrar cursos sin inscripciones'),
  ('content.upload',        'Cursos',       'Subir archivos de capacitación'),
  ('questions.read',        'Exámenes',     'Ver el banco de preguntas'),
  ('questions.write',       'Exámenes',     'Crear y editar preguntas'),
  ('exams.write',           'Exámenes',     'Crear y editar exámenes'),
  ('assignments.read',      'Asignaciones', 'Ver asignaciones'),
  ('assignments.write',     'Asignaciones', 'Asignar cursos'),
  ('enrollments.adjust',    'Asignaciones', 'Prórrogas, intentos extra, cancelar y reasignar'),
  ('grading.grade',         'Calificación', 'Calificar respuestas abiertas'),
  ('grading.override',      'Calificación', 'Recalificar respuestas automáticas y anular intentos'),
  ('progress.read',         'Seguimiento',  'Ver avance y calificaciones de otros'),
  ('reports.read',          'Reportes',     'Ver reportes'),
  ('reports.export',        'Reportes',     'Exportar reportes'),
  ('dashboard.executive',   'Reportes',     'Ver el tablero de Dirección'),
  ('certificates.read',     'Certificados', 'Ver certificados de otros'),
  ('certificates.revoke',   'Certificados', 'Revocar certificados'),
  ('notifications.manage',  'Sistema',      'Administrar reglas de recordatorio y plantillas'),
  ('audit.read',            'Sistema',      'Consultar la bitácora de auditoría'),
  ('settings.manage',       'Sistema',      'Configuración global y por empresa');

insert into public.roles (key, name, description, is_system, requires_mfa) values
  ('super_admin',    'Super Admin',                  'Acceso total al sistema', true, true),
  ('training_admin', 'Administrador de Capacitación','Cursos, exámenes, asignaciones, calificación y reportes', true, true),
  ('hr_admin',       'Administrador de RH',          'Alta y gestión de usuarios y reportes', true, true),
  ('manager',        'Jefe / Manager',               'Consulta el avance y cumplimiento de su equipo', true, false),
  ('instructor',     'Instructor',                   'Crea contenido y califica sus cursos', true, false),
  ('executive',      'Dirección',                    'Tablero ejecutivo de solo lectura', true, false);

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.key = 'super_admin';

insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r cross join unnest(array[
  'org.read','users.read','courses.read','courses.create','courses.update','courses.review','courses.publish',
  'courses.suspend','courses.archive','content.upload','questions.read','questions.write','exams.write',
  'assignments.read','assignments.write','enrollments.adjust','grading.grade','grading.override','progress.read',
  'reports.read','reports.export','certificates.read','notifications.manage'
]) k where r.key = 'training_admin';

insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r cross join unnest(array[
  'org.read','users.read','users.create','users.update','users.deactivate','users.import',
  'assignments.read','progress.read','reports.read','reports.export','certificates.read'
]) k where r.key = 'hr_admin';

insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r cross join unnest(array[
  'org.read','users.read','courses.read','assignments.read','progress.read','reports.read','reports.export','certificates.read'
]) k where r.key = 'manager';

-- El instructor obtiene alcance por curso (course_instructors, Fase 2); estos permisos se combinan con esa relación.
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r cross join unnest(array[
  'courses.read','courses.create','courses.update','content.upload','questions.read','questions.write','exams.write','grading.grade'
]) k where r.key = 'instructor';

insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r cross join unnest(array[
  'org.read','dashboard.executive','reports.read','progress.read'
]) k where r.key = 'executive';

-- ---------------------------------------------------------------------
-- Funciones de autorización (base de todas las políticas RLS)
-- ---------------------------------------------------------------------

-- ¿El usuario del JWT tiene un perfil activo?
create or replace function app.is_active_user()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and status = 'active')
$$;

create or replace function app.my_company_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select company_id from public.profiles where id = (select auth.uid()) and status = 'active'
$$;

-- Nivel de autenticación de la sesión (aal1 = contraseña, aal2 = contraseña + MFA).
create or replace function app.session_aal()
returns text language sql stable set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1')
$$;

-- Permisos vigentes del usuario actual con su alcance.
-- Un rol que exige MFA solo cuenta si la sesión es aal2.
create or replace function app.my_grants()
returns table (permission_key text, scope_type public.scope_type, scope_id uuid)
language sql stable security definer set search_path = ''
as $$
  select rp.permission_key, ur.scope_type, ur.scope_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.profiles me on me.id = ur.user_id and me.status = 'active'
  where ur.user_id = (select auth.uid())
    and ur.revoked_at is null
    and (ur.expires_at is null or ur.expires_at > now())
    and (not r.requires_mfa or app.session_aal() = 'aal2')
$$;

-- Departamento y todos sus departamentos padre (un alcance sobre "Operaciones" cubre sus sub-áreas).
create or replace function app.department_lineage(p_department uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  with recursive up as (
    select id, parent_id from public.departments where id = p_department
    union all
    select d.id, d.parent_id from public.departments d join up on d.id = up.parent_id
  ) select coalesce(array_agg(id), '{}') from up
$$;

-- ¿Tiene el permiso sobre un sujeto ubicado en (empresa, sucursal, departamento, usuario)?
create or replace function app.can(
  p_perm text,
  p_company uuid default null,
  p_branch uuid default null,
  p_department uuid default null,
  p_subject uuid default null
) returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from app.my_grants() g
    where g.permission_key = p_perm
      and (
        g.scope_type = 'group'
        or (g.scope_type = 'company' and g.scope_id = p_company)
        or (g.scope_type = 'branch' and p_branch is not null and g.scope_id = p_branch)
        or (g.scope_type = 'department' and p_department is not null and g.scope_id = any (app.department_lineage(p_department)))
        or (g.scope_type = 'team' and p_subject is not null and exists (
              select 1 from public.profile_hierarchy h
              where h.ancestor_id = (select auth.uid()) and h.descendant_id = p_subject and h.depth > 0))
      )
  )
$$;

-- ¿Tiene el permiso en algún alcance? (menús y pantallas; la autorización fina usa app.can)
create or replace function app.can_any(p_perm text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from app.my_grants() where permission_key = p_perm)
$$;

-- ¿Tiene el permiso con alcance de todo el grupo?
create or replace function app.can_group(p_perm text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from app.my_grants() where permission_key = p_perm and scope_type = 'group')
$$;

-- ¿Tiene el permiso sobre un usuario concreto?
create or replace function app.can_user(p_perm text, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and app.can(p_perm, p.company_id, p.branch_id, p.department_id, p.id)
  )
$$;

-- Lanza FORBIDDEN si no tiene el permiso (para usar al inicio de las RPC).
create or replace function app.assert_can(
  p_perm text, p_company uuid default null, p_branch uuid default null,
  p_department uuid default null, p_subject uuid default null
) returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.can(p_perm, p_company, p_branch, p_department, p_subject) then
    perform app.fail('FORBIDDEN', p_perm);
  end if;
end $$;

-- Las políticas RLS se evalúan con los privilegios del usuario: necesita EXECUTE sobre estas funciones.
grant execute on function
  app.is_active_user(), app.my_company_id(), app.session_aal(), app.my_grants(),
  app.department_lineage(uuid), app.can(text, uuid, uuid, uuid, uuid), app.can_any(text),
  app.can_group(text), app.can_user(text, uuid), app.unaccent_i(text), app.norm(text)
to authenticated, service_role;
