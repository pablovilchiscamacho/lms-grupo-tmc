-- =====================================================================
-- 0006 · Row Level Security y privilegios de la Fase 1
-- Regla: anon no ve nada; authenticated recibe solo lo necesario; las escrituras
-- sensibles (perfiles, roles) van por RPC y no tienen privilegio directo.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array['companies','branches','departments','positions','files','profiles','profile_hierarchy',
                           'user_groups','user_group_members','settings','roles','permissions','role_permissions','user_roles']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Organización
-- ---------------------------------------------------------------------
grant select, insert, update on public.companies, public.branches, public.departments, public.positions to authenticated;

create policy companies_select on public.companies for select to authenticated
  using (app.is_active_user() and (id = app.my_company_id() or app.can('org.read', id)));
create policy companies_insert on public.companies for insert to authenticated
  with check (app.can_group('org.manage'));
create policy companies_update on public.companies for update to authenticated
  using (app.can_group('org.manage')) with check (app.can_group('org.manage'));

create policy branches_select on public.branches for select to authenticated
  using (app.is_active_user() and (company_id = app.my_company_id() or app.can('org.read', company_id, id)));
create policy branches_insert on public.branches for insert to authenticated
  with check (app.can('org.manage', company_id));
create policy branches_update on public.branches for update to authenticated
  using (app.can('org.manage', company_id)) with check (app.can('org.manage', company_id));

create policy departments_select on public.departments for select to authenticated
  using (app.is_active_user() and (company_id = app.my_company_id() or app.can('org.read', company_id, null, id)));
create policy departments_insert on public.departments for insert to authenticated
  with check (app.can('org.manage', company_id));
create policy departments_update on public.departments for update to authenticated
  using (app.can('org.manage', company_id)) with check (app.can('org.manage', company_id));

create policy positions_select on public.positions for select to authenticated
  using (app.is_active_user() and (company_id = app.my_company_id() or app.can('org.read', company_id, null, department_id)));
create policy positions_insert on public.positions for insert to authenticated
  with check (app.can('org.manage', company_id));
create policy positions_update on public.positions for update to authenticated
  using (app.can('org.manage', company_id)) with check (app.can('org.manage', company_id));

-- ---------------------------------------------------------------------
-- Identidad
-- ---------------------------------------------------------------------
grant select on public.profiles to authenticated;   -- sin INSERT/UPDATE/DELETE: solo vía RPC

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (app.is_active_user() and (
         app.can('users.read', company_id, branch_id, department_id, id)
      or app.can('progress.read', company_id, branch_id, department_id, id)))
  );

grant select on public.profile_hierarchy to authenticated;
create policy profile_hierarchy_select on public.profile_hierarchy for select to authenticated
  using (ancestor_id = (select auth.uid()) or descendant_id = (select auth.uid())
         or app.can_user('users.read', descendant_id));

grant select on public.roles, public.permissions, public.role_permissions to authenticated;
create policy roles_select on public.roles for select to authenticated using (app.is_active_user());
create policy permissions_select on public.permissions for select to authenticated using (app.is_active_user());
create policy role_permissions_select on public.role_permissions for select to authenticated using (app.is_active_user());

grant insert, delete on public.role_permissions to authenticated;
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (app.can_group('settings.manage'));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (app.can_group('settings.manage'));

grant select on public.user_roles to authenticated;  -- escritura solo vía admin_grant_role / admin_revoke_role
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or app.can_group('roles.assign') or app.can_user('users.read', user_id));

-- ---------------------------------------------------------------------
-- Grupos de usuarios (destino de asignaciones, Fase 4)
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.user_groups to authenticated;
grant select, insert, delete on public.user_group_members to authenticated;

create policy user_groups_select on public.user_groups for select to authenticated
  using (app.is_active_user() and (app.can_any('assignments.read') or app.can_any('users.read'))
         and (company_id is null or app.can('assignments.read', company_id) or app.can('users.read', company_id)
              or company_id = app.my_company_id()));
create policy user_groups_write on public.user_groups for all to authenticated
  using (case when company_id is null then app.can_group('assignments.write') else app.can('assignments.write', company_id) end)
  with check (case when company_id is null then app.can_group('assignments.write') else app.can('assignments.write', company_id) end);

create policy user_group_members_select on public.user_group_members for select to authenticated
  using (exists (select 1 from public.user_groups g where g.id = group_id));
create policy user_group_members_write on public.user_group_members for all to authenticated
  using (exists (select 1 from public.user_groups g where g.id = group_id and
           case when g.company_id is null then app.can_group('assignments.write') else app.can('assignments.write', g.company_id) end)
         and app.can_user('users.read', user_id))
  with check (exists (select 1 from public.user_groups g where g.id = group_id and
           case when g.company_id is null then app.can_group('assignments.write') else app.can('assignments.write', g.company_id) end)
         and app.can_user('users.read', user_id));

-- ---------------------------------------------------------------------
-- Configuración y archivos
-- ---------------------------------------------------------------------
grant select, insert, update on public.settings to authenticated;
create policy settings_select on public.settings for select to authenticated
  using (app.is_active_user() and (not is_private or app.can_group('settings.manage')));
create policy settings_write_insert on public.settings for insert to authenticated
  with check (case when company_id is null then app.can_group('settings.manage') else app.can('settings.manage', company_id) end);
create policy settings_write_update on public.settings for update to authenticated
  using (case when company_id is null then app.can_group('settings.manage') else app.can('settings.manage', company_id) end)
  with check (case when company_id is null then app.can_group('settings.manage') else app.can('settings.manage', company_id) end);

-- Fase 1: solo lectura de lo propio. La subida segura y sus políticas llegan en la Fase 2.
grant select on public.files to authenticated;
create policy files_select on public.files for select to authenticated
  using (uploaded_by = (select auth.uid()) or app.can_group('settings.manage'));

-- ---------------------------------------------------------------------
-- Configuración inicial (global)
-- ---------------------------------------------------------------------
insert into public.settings (key, value) values
  ('branding',               '{"group_name": "Grupo TMC", "primary_color": "#0f2a4a", "logo_file_id": null}'),
  ('locale',                 '{"language": "es-MX", "timezone": "America/Mexico_City", "date_format": "dd/MM/yyyy"}'),
  ('defaults.exams',         '{"passing_score": 80, "max_attempts": 3, "time_limit_minutes": 30}'),
  ('security.passwords',     '{"min_length": 10}');
