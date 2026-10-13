-- Rendimiento de RLS. Con 200+ personas las listas tardaban hasta ~1 s dentro de la base: las políticas llamaban
-- app.can()/app.can_user() POR RENGLÓN (≈1 ms cada llamada en el servidor), varias veces por renglón y otra vez en
-- cada tabla relacionada (empresa, sucursal, departamento, puesto).
--
-- Ahora cada política compara contra un conjunto que se calcula UNA vez por consulta:
--   «x in (select ... from app.scope_xxx(...))» es una subconsulta sin correlación → Postgres la evalúa una sola
--   vez (hashed SubPlan), y «(select app.is_active_user())» queda como InitPlan.
-- La regla de autorización es la misma que app.can(): grupo → todo; empresa → esa empresa; sucursal → esa
-- sucursal; departamento → ese departamento y sus sub-áreas; equipo → su línea de reporte.

-- Empresas dentro del alcance de un permiso (todas si es de grupo).
create or replace function app.scope_company_ids(p_perm text)
returns table (id uuid) language sql stable security definer set search_path = ''
as $$
  select c.id from public.companies c
  where exists (select 1 from app.my_grants() g where g.permission_key = p_perm and g.scope_type = 'group')
     or c.id in (select g.scope_id from app.my_grants() g where g.permission_key = p_perm and g.scope_type = 'company')
$$;

-- Departamentos dentro del alcance: los de empresas en alcance + los otorgados y sus sub-áreas.
create or replace function app.scope_department_ids(p_perm text)
returns table (id uuid) language sql stable security definer set search_path = ''
as $$
  with recursive dep as (
    select d.id from public.departments d
    where d.id in (select g.scope_id from app.my_grants() g where g.permission_key = p_perm and g.scope_type = 'department')
    union
    select c.id from public.departments c join dep on c.parent_id = dep.id
  )
  select d.id from public.departments d where d.company_id in (select s.id from app.scope_company_ids(p_perm) s)
  union
  select dep.id from dep
$$;

-- Sucursales dentro del alcance: las de empresas en alcance + las otorgadas directamente.
create or replace function app.scope_branch_ids(p_perm text)
returns table (id uuid) language sql stable security definer set search_path = ''
as $$
  select b.id from public.branches b where b.company_id in (select s.id from app.scope_company_ids(p_perm) s)
  union
  select g.scope_id from app.my_grants() g where g.permission_key = p_perm and g.scope_type = 'branch'
$$;

grant execute on function app.scope_profiles(text) to authenticated;
grant execute on function app.scope_company_ids(text) to authenticated;
grant execute on function app.scope_department_ids(text) to authenticated;
grant execute on function app.scope_branch_ids(text) to authenticated;

-- Organización
alter policy companies_select on public.companies using (
  (select app.is_active_user()) and (id = (select app.my_company_id()) or id in (select s.id from app.scope_company_ids('org.read') s)));
alter policy branches_select on public.branches using (
  (select app.is_active_user()) and (company_id = (select app.my_company_id()) or id in (select s.id from app.scope_branch_ids('org.read') s)));
alter policy departments_select on public.departments using (
  (select app.is_active_user()) and (company_id = (select app.my_company_id()) or id in (select s.id from app.scope_department_ids('org.read') s)));
alter policy positions_select on public.positions using (
  (select app.is_active_user()) and (company_id = (select app.my_company_id())
    or company_id in (select s.id from app.scope_company_ids('org.read') s)
    or department_id in (select s.id from app.scope_department_ids('org.read') s)));

-- Personas y lo que cuelga de ellas
alter policy profiles_select on public.profiles using (
  id = (select auth.uid())
  or ((select app.is_active_user()) and (
        id in (select s.id from app.scope_profiles('users.read') s)
     or id in (select s.id from app.scope_profiles('progress.read') s))));
alter policy profile_hierarchy_select on public.profile_hierarchy using (
  ancestor_id = (select auth.uid()) or descendant_id = (select auth.uid())
  or descendant_id in (select s.id from app.scope_profiles('users.read') s));
alter policy user_roles_select on public.user_roles using (
  user_id = (select auth.uid()) or (select app.can_group('roles.assign'))
  or user_id in (select s.id from app.scope_profiles('users.read') s));
alter policy privacy_acceptances_select on public.privacy_acceptances using (
  user_id = (select auth.uid()) or user_id in (select s.id from app.scope_profiles('users.read') s));
alter policy certificates_select on public.certificates using (
  user_id = (select auth.uid()) or user_id in (select s.id from app.scope_profiles('certificates.read') s));
alter policy enrollments_select on public.enrollments using (
  user_id = (select auth.uid())
  or ((select app.is_active_user()) and (
        user_id in (select s.id from app.scope_profiles('progress.read') s)
     or (app.is_course_instructor(course_id) and (select app.can_any('grading.grade'))))));
alter policy exam_attempts_select on public.exam_attempts using (
  (select app.is_active_user()) and (user_id in (select s.id from app.scope_profiles('progress.read') s) or app.can_grade(id)));
