-- =====================================================================
-- 0005 · Contexto de sesión, gestión de usuarios, roles, login y bitácora (RPC)
-- Las funciones de public.* son la API que llama la app. Todas validan permisos adentro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contexto del usuario actual
-- ---------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'first_name', p.first_name, 'last_name_paternal', p.last_name_paternal,
      'last_name_maternal', p.last_name_maternal, 'full_name', p.full_name, 'email', p.email,
      'has_real_email', p.has_real_email, 'employee_number', p.employee_number, 'username', p.username,
      'phone', p.phone, 'status', p.status, 'must_change_password', p.must_change_password,
      'hire_date', p.hire_date, 'last_login_at', p.last_login_at, 'created_at', p.created_at,
      'company', jsonb_build_object('id', c.id, 'name', c.name, 'short_name', c.short_name, 'timezone', c.timezone),
      'branch', case when b.id is not null then jsonb_build_object('id', b.id, 'name', b.name) end,
      'department', case when d.id is not null then jsonb_build_object('id', d.id, 'name', d.name) end,
      'position', case when po.id is not null then jsonb_build_object('id', po.id, 'name', po.name) end,
      'manager', case when m.id is not null then jsonb_build_object('id', m.id, 'full_name', m.full_name) end
    ),
    'permissions', coalesce((select jsonb_agg(distinct g.permission_key) from app.my_grants() g), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'scope_type', ur.scope_type,
                                          'scope_id', ur.scope_id, 'requires_mfa', r.requires_mfa))
      from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.user_id = p.id and ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now())
    ), '[]'::jsonb),
    'requires_mfa', exists (
      select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.user_id = p.id and ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now())
        and r.requires_mfa
    ),
    'aal', app.session_aal()
  )
  from public.profiles p
  join public.companies c on c.id = p.company_id
  left join public.branches b on b.id = p.branch_id
  left join public.departments d on d.id = p.department_id
  left join public.positions po on po.id = p.position_id
  left join public.profiles m on m.id = p.manager_id
  where p.id = (select auth.uid())
$$;
grant execute on function public.my_context() to authenticated;

-- ---------------------------------------------------------------------
-- Validación de datos de usuario (mensajes por campo)
-- ---------------------------------------------------------------------
create or replace function app.validate_user_payload(p jsonb, p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  e jsonb := '{}'::jsonb;
  v_company uuid := nullif(p ->> 'company_id', '')::uuid;
  v_email text := nullif(lower(trim(p ->> 'email')), '');
  v_username text := nullif(lower(trim(p ->> 'username')), '');
  v_emp text := nullif(trim(p ->> 'employee_number'), '');
  v_manager uuid := nullif(p ->> 'manager_id', '')::uuid;
begin
  if coalesce(trim(p ->> 'first_name'), '') = '' then e := e || '{"first_name":"required"}'; end if;
  if coalesce(trim(p ->> 'last_name_paternal'), '') = '' then e := e || '{"last_name_paternal":"required"}'; end if;
  if v_company is null then
    e := e || '{"company_id":"required"}';
  elsif not exists (select 1 from public.companies where id = v_company and is_active) then
    e := e || '{"company_id":"not_found"}';
  end if;

  if coalesce((p ->> 'has_real_email')::boolean, true) and v_email is null then
    e := e || '{"email":"required"}';
  end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    e := e || '{"email":"invalid"}';
  elsif v_email is not null and exists (
    select 1 from public.profiles where (lower(email) = v_email or lower(auth_email) = v_email) and id is distinct from p_user_id
  ) then
    e := e || '{"email":"taken"}';
  end if;

  if v_username is not null and v_username !~ '^[a-z0-9._-]{3,40}$' then
    e := e || '{"username":"invalid"}';
  elsif v_username is not null and exists (
    select 1 from public.profiles where lower(username) = v_username and id is distinct from p_user_id
  ) then
    e := e || '{"username":"taken"}';
  end if;

  if v_emp is not null and v_emp !~ '^[A-Za-z0-9_-]{1,30}$' then
    e := e || '{"employee_number":"invalid"}';
  elsif v_emp is not null and exists (
    select 1 from public.profiles where company_id = v_company and employee_number = v_emp and id is distinct from p_user_id
  ) then
    e := e || '{"employee_number":"taken"}';
  end if;

  if nullif(p ->> 'branch_id', '') is not null and not exists (
    select 1 from public.branches where id = (p ->> 'branch_id')::uuid and company_id = v_company) then
    e := e || '{"branch_id":"org_mismatch"}';
  end if;
  if nullif(p ->> 'department_id', '') is not null and not exists (
    select 1 from public.departments where id = (p ->> 'department_id')::uuid and company_id = v_company) then
    e := e || '{"department_id":"org_mismatch"}';
  end if;
  if nullif(p ->> 'position_id', '') is not null and not exists (
    select 1 from public.positions where id = (p ->> 'position_id')::uuid and company_id = v_company) then
    e := e || '{"position_id":"org_mismatch"}';
  end if;

  if v_manager is not null then
    if v_manager = p_user_id then
      e := e || '{"manager_id":"self"}';
    elsif not exists (select 1 from public.profiles where id = v_manager and status <> 'deleted') then
      e := e || '{"manager_id":"not_found"}';
    elsif p_user_id is not null and exists (
      select 1 from public.profile_hierarchy where ancestor_id = p_user_id and descendant_id = v_manager) then
      e := e || '{"manager_id":"cycle"}';
    end if;
  end if;

  if nullif(p ->> 'phone', '') is not null and (p ->> 'phone') !~ '^[0-9 +()-]{7,20}$' then
    e := e || '{"phone":"invalid"}';
  end if;
  return e;
end $$;

-- Validación previa (sin escribir). La usa el formulario antes de crear el usuario en Auth.
create or replace function public.admin_validate_user(p jsonb, p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := nullif(p ->> 'company_id', '')::uuid;
begin
  perform app.assert_can(case when p_user_id is null then 'users.create' else 'users.update' end,
    v_company, nullif(p ->> 'branch_id', '')::uuid, nullif(p ->> 'department_id', '')::uuid, p_user_id);
  return app.validate_user_payload(p, p_user_id);
end $$;
grant execute on function public.admin_validate_user(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Protección de cuentas administrativas: solo quien puede asignar roles (Super Admin)
-- puede editar, desactivar o restablecer la contraseña de alguien con un rol administrativo.
-- Evita, por ejemplo, que RH cambie el correo de un Super Admin y tome su cuenta.
-- ---------------------------------------------------------------------
create or replace function app.assert_can_manage_target(p_user_id uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = p_user_id and ur.revoked_at is null and r.requires_mfa
  ) and not app.can_group('roles.assign') then
    perform app.fail('FORBIDDEN', 'protected_admin');
  end if;
end $$;

-- Verificación previa a acciones que el servidor hace con service role (restablecer contraseña, reenviar invitación).
create or replace function public.admin_check_user_action(p_user_id uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.profiles;
begin
  if p_perm not in ('users.update', 'users.deactivate') then perform app.fail('VALIDATION', 'perm'); end if;
  select * into v from public.profiles where id = p_user_id;
  if not found then perform app.fail('NOT_FOUND', 'user'); end if;
  perform app.assert_can(p_perm, v.company_id, v.branch_id, v.department_id, v.id);
  if p_user_id = (select auth.uid()) then perform app.fail('CANNOT_CHANGE_SELF'); end if;
  perform app.assert_can_manage_target(p_user_id);
end $$;
grant execute on function public.admin_check_user_action(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Alta: el servidor crea primero el usuario de Auth (service role) y luego llama esta función con el JWT del admin.
-- ---------------------------------------------------------------------
create or replace function public.admin_create_user(p_user_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := nullif(p ->> 'company_id', '')::uuid;
  v_branch uuid := nullif(p ->> 'branch_id', '')::uuid;
  v_dept uuid := nullif(p ->> 'department_id', '')::uuid;
  v_errors jsonb;
  v_perm text := case when coalesce((p ->> 'via_import')::boolean, false) then 'users.import' else 'users.create' end;
begin
  perform app.assert_can(v_perm, v_company, v_branch, v_dept, null);
  v_errors := app.validate_user_payload(p, p_user_id);
  if v_errors <> '{}'::jsonb then
    perform app.fail('VALIDATION', v_errors::text);
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    perform app.fail('NOT_FOUND', 'auth_user');
  end if;

  insert into public.profiles (
    id, employee_number, username, first_name, last_name_paternal, last_name_maternal, email, auth_email,
    has_real_email, phone, company_id, branch_id, department_id, position_id, manager_id, hire_date,
    must_change_password, created_by
  ) values (
    p_user_id,
    nullif(trim(p ->> 'employee_number'), ''),
    nullif(lower(trim(p ->> 'username')), ''),
    trim(p ->> 'first_name'),
    trim(p ->> 'last_name_paternal'),
    nullif(trim(p ->> 'last_name_maternal'), ''),
    nullif(lower(trim(p ->> 'email')), ''),
    lower(trim(case when coalesce((p ->> 'has_real_email')::boolean, true) then p ->> 'email' else p ->> 'auth_email' end)),
    coalesce((p ->> 'has_real_email')::boolean, true),
    nullif(trim(p ->> 'phone'), ''),
    v_company, v_branch, v_dept,
    nullif(p ->> 'position_id', '')::uuid,
    nullif(p ->> 'manager_id', '')::uuid,
    nullif(p ->> 'hire_date', '')::date,
    coalesce((p ->> 'must_change_password')::boolean, false),
    app.actor_id()
  );
  return p_user_id;
end $$;
grant execute on function public.admin_create_user(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Edición: requiere permiso sobre la ubicación actual Y sobre la nueva.
-- ---------------------------------------------------------------------
create or replace function public.admin_update_user(p_user_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_cur public.profiles;
  v_errors jsonb;
  v_merged jsonb;
begin
  select * into v_cur from public.profiles where id = p_user_id for update;
  if not found then perform app.fail('NOT_FOUND', 'user'); end if;
  perform app.assert_can('users.update', v_cur.company_id, v_cur.branch_id, v_cur.department_id, v_cur.id);
  perform app.assert_can_manage_target(p_user_id);

  -- Campos no enviados conservan su valor actual.
  v_merged := (to_jsonb(v_cur) - 'id') || p;
  perform app.assert_can('users.update', nullif(v_merged ->> 'company_id', '')::uuid,
    nullif(v_merged ->> 'branch_id', '')::uuid, nullif(v_merged ->> 'department_id', '')::uuid, p_user_id);
  v_errors := app.validate_user_payload(v_merged, p_user_id);
  if v_errors <> '{}'::jsonb then
    perform app.fail('VALIDATION', v_errors::text);
  end if;

  update public.profiles set
    employee_number    = nullif(trim(v_merged ->> 'employee_number'), ''),
    username           = nullif(lower(trim(v_merged ->> 'username')), ''),
    first_name         = trim(v_merged ->> 'first_name'),
    last_name_paternal = trim(v_merged ->> 'last_name_paternal'),
    last_name_maternal = nullif(trim(v_merged ->> 'last_name_maternal'), ''),
    email              = nullif(lower(trim(v_merged ->> 'email')), ''),
    auth_email         = lower(trim(case when coalesce((v_merged ->> 'has_real_email')::boolean, true)
                                         then v_merged ->> 'email' else v_merged ->> 'auth_email' end)),
    has_real_email     = coalesce((v_merged ->> 'has_real_email')::boolean, true),
    phone              = nullif(trim(v_merged ->> 'phone'), ''),
    company_id         = (v_merged ->> 'company_id')::uuid,
    branch_id          = nullif(v_merged ->> 'branch_id', '')::uuid,
    department_id      = nullif(v_merged ->> 'department_id', '')::uuid,
    position_id        = nullif(v_merged ->> 'position_id', '')::uuid,
    manager_id         = nullif(v_merged ->> 'manager_id', '')::uuid,
    hire_date          = nullif(v_merged ->> 'hire_date', '')::date
  where id = p_user_id;

  return jsonb_build_object('old_auth_email', v_cur.auth_email);
end $$;
grant execute on function public.admin_update_user(uuid, jsonb) to authenticated;

-- El propio usuario solo puede cambiar su teléfono.
create or replace function public.update_my_phone(p_phone text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_active_user() then perform app.fail('FORBIDDEN'); end if;
  if nullif(trim(p_phone), '') is not null and trim(p_phone) !~ '^[0-9 +()-]{7,20}$' then
    perform app.fail('VALIDATION', '{"phone":"invalid"}');
  end if;
  update public.profiles set phone = nullif(trim(p_phone), '') where id = (select auth.uid());
end $$;
grant execute on function public.update_my_phone(text) to authenticated;

-- ---------------------------------------------------------------------
-- Estado del usuario (activo / inactivo / suspendido / baja lógica)
-- ---------------------------------------------------------------------
create or replace function app.active_super_admins()
returns int language sql stable security definer set search_path = ''
as $$
  select count(distinct ur.user_id)::int
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.key = 'super_admin'
  join public.profiles p on p.id = ur.user_id and p.status = 'active'
  where ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now())
$$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status public.user_status, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_cur public.profiles;
begin
  select * into v_cur from public.profiles where id = p_user_id for update;
  if not found then perform app.fail('NOT_FOUND', 'user'); end if;
  perform app.assert_can('users.deactivate', v_cur.company_id, v_cur.branch_id, v_cur.department_id, v_cur.id);
  if p_user_id = (select auth.uid()) then perform app.fail('CANNOT_CHANGE_SELF'); end if;
  perform app.assert_can_manage_target(p_user_id);
  if v_cur.status = p_status then return; end if;
  if v_cur.status = 'deleted' then perform app.fail('USER_DELETED'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', '{"reason":"required"}'); end if;
  if p_status <> 'active' and exists (
       select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
       where ur.user_id = p_user_id and r.key = 'super_admin' and ur.revoked_at is null)
     and app.active_super_admins() <= 1 then
    perform app.fail('LAST_SUPER_ADMIN');
  end if;

  update public.profiles set
    status = p_status,
    status_reason = trim(p_reason),
    status_changed_at = now(),
    deleted_at = case when p_status = 'deleted' then now() end,
    deleted_by = case when p_status = 'deleted' then app.actor_id() end
  where id = p_user_id;
  -- Fase 4: aquí se cancelan las inscripciones no iniciadas (D6 / baja).
end $$;
grant execute on function public.admin_set_user_status(uuid, public.user_status, text) to authenticated;

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
create or replace function public.admin_grant_role(
  p_user_id uuid, p_role_key text, p_scope_type public.scope_type, p_scope_id uuid default null,
  p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.roles;
  v_id uuid;
begin
  if not app.can_group('roles.assign') then perform app.fail('FORBIDDEN', 'roles.assign'); end if;
  if p_user_id = (select auth.uid()) then perform app.fail('CANNOT_CHANGE_SELF'); end if;
  select * into v_role from public.roles where key = p_role_key;
  if not found then perform app.fail('NOT_FOUND', 'role'); end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    perform app.fail('NOT_FOUND', 'user');
  end if;
  -- No se puede otorgar un permiso que uno mismo no tiene con alcance de grupo.
  if exists (
    select 1 from public.role_permissions rp where rp.role_id = v_role.id
    and not exists (select 1 from app.my_grants() g where g.permission_key = rp.permission_key and g.scope_type = 'group')
  ) then
    perform app.fail('FORBIDDEN', 'escalation');
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    perform app.fail('VALIDATION', '{"expires_at":"past"}');
  end if;

  insert into public.user_roles (user_id, role_id, scope_type, scope_id, granted_by, expires_at)
  values (p_user_id, v_role.id, p_scope_type, case when p_scope_type in ('group', 'team') then null else p_scope_id end,
          app.actor_id(), p_expires_at)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  perform app.fail('ROLE_ALREADY_ASSIGNED');
  return null;
end $$;
grant execute on function public.admin_grant_role(uuid, text, public.scope_type, uuid, timestamptz) to authenticated;

create or replace function public.admin_revoke_role(p_user_role_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_ur public.user_roles;
  v_key text;
begin
  if not app.can_group('roles.assign') then perform app.fail('FORBIDDEN', 'roles.assign'); end if;
  select * into v_ur from public.user_roles where id = p_user_role_id and revoked_at is null for update;
  if not found then perform app.fail('NOT_FOUND', 'user_role'); end if;
  if v_ur.user_id = (select auth.uid()) then perform app.fail('CANNOT_CHANGE_SELF'); end if;
  select key into v_key from public.roles where id = v_ur.role_id;
  if v_key = 'super_admin' and app.active_super_admins() <= 1
     and exists (select 1 from public.profiles where id = v_ur.user_id and status = 'active') then
    perform app.fail('LAST_SUPER_ADMIN');
  end if;
  update public.user_roles set revoked_at = now(), revoked_by = app.actor_id() where id = p_user_role_id;
end $$;
grant execute on function public.admin_revoke_role(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Importación masiva: valida y resuelve nombres → ids (no escribe)
-- Cada fila: nombre, apellido_paterno, apellido_materno, email, numero_empleado, usuario,
--            empresa, sucursal, departamento, puesto, jefe, telefono, fecha_ingreso
-- ---------------------------------------------------------------------
create or replace function public.admin_validate_import(p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  r jsonb;
  i int := 0;
  out jsonb := '[]'::jsonb;
  errs text[];
  v_status text;
  v_company uuid; v_branch uuid; v_dept uuid; v_pos uuid; v_manager uuid; v_manager_ref text;
  v_email text; v_emp text; v_user text; v_hire date;
  seen_email text[] := '{}';
  seen_emp text[] := '{}';
  seen_user text[] := '{}';
  v_payload jsonb;
  v_val jsonb;
begin
  if not app.can_any('users.import') then perform app.fail('FORBIDDEN', 'users.import'); end if;
  if jsonb_array_length(p_rows) > 2000 then perform app.fail('IMPORT_TOO_LARGE'); end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    errs := '{}';
    v_status := 'valid';
    v_company := null; v_branch := null; v_dept := null; v_pos := null; v_manager := null; v_manager_ref := null; v_hire := null;
    v_email := nullif(lower(trim(r ->> 'email')), '');
    v_emp := nullif(trim(r ->> 'numero_empleado'), '');
    v_user := nullif(lower(trim(r ->> 'usuario')), '');

    select id into v_company from public.companies
     where is_active and (app.norm(short_name) = app.norm(r ->> 'empresa') or app.norm(name) = app.norm(r ->> 'empresa')) limit 1;
    if v_company is null then errs := array_append(errs, 'Empresa no encontrada'); end if;

    if v_company is not null then
      if nullif(trim(r ->> 'sucursal'), '') is not null then
        select id into v_branch from public.branches where company_id = v_company and is_active
          and (app.norm(code) = app.norm(r ->> 'sucursal') or app.norm(name) = app.norm(r ->> 'sucursal')) limit 1;
        if v_branch is null then errs := array_append(errs, 'Sucursal no encontrada'); end if;
      end if;
      if nullif(trim(r ->> 'departamento'), '') is not null then
        select id into v_dept from public.departments where company_id = v_company and is_active
          and (app.norm(code) = app.norm(r ->> 'departamento') or app.norm(name) = app.norm(r ->> 'departamento')) limit 1;
        if v_dept is null then errs := array_append(errs, 'Departamento no encontrado'); end if;
      end if;
      if nullif(trim(r ->> 'puesto'), '') is not null then
        select id into v_pos from public.positions where company_id = v_company and is_active
          and (app.norm(code) = app.norm(r ->> 'puesto') or app.norm(name) = app.norm(r ->> 'puesto')) limit 1;
        if v_pos is null then errs := array_append(errs, 'Puesto no encontrado'); end if;
      end if;
      if v_company is not null and not app.can('users.import', v_company, v_branch, v_dept) then
        errs := array_append(errs, 'Sin permiso para esa empresa/área');
      end if;
    end if;

    -- Jefe: número de empleado o correo; puede estar en el mismo archivo (se liga después de crear).
    v_manager_ref := nullif(trim(r ->> 'jefe'), '');
    if v_manager_ref is not null then
      select id into v_manager from public.profiles
       where status <> 'deleted'
         and (lower(email) = lower(v_manager_ref) or (employee_number = v_manager_ref and company_id = v_company))
       limit 1;
    end if;

    if nullif(trim(r ->> 'fecha_ingreso'), '') is not null then
      begin
        v_hire := (r ->> 'fecha_ingreso')::date;
      exception when others then
        errs := array_append(errs, 'Fecha de ingreso inválida (use AAAA-MM-DD)');
      end;
    end if;

    v_payload := jsonb_build_object(
      'first_name', r ->> 'nombre', 'last_name_paternal', r ->> 'apellido_paterno',
      'last_name_maternal', r ->> 'apellido_materno', 'email', v_email, 'has_real_email', v_email is not null,
      'employee_number', v_emp, 'username', v_user, 'phone', r ->> 'telefono',
      'company_id', v_company, 'branch_id', v_branch, 'department_id', v_dept, 'position_id', v_pos,
      'manager_id', v_manager, 'hire_date', v_hire
    );

    if v_company is not null then
      v_val := app.validate_user_payload(v_payload, null) - 'manager_id';
      if v_val ? 'first_name' then errs := array_append(errs, 'Falta el nombre'); end if;
      if v_val ? 'last_name_paternal' then errs := array_append(errs, 'Falta el apellido paterno'); end if;
      if v_val ->> 'email' = 'invalid' then errs := array_append(errs, 'Correo inválido'); end if;
      if v_val ->> 'username' = 'invalid' then errs := array_append(errs, 'Usuario inválido (3-40: letras, números, . _ -)'); end if;
      if v_val ->> 'employee_number' = 'invalid' then errs := array_append(errs, 'Número de empleado inválido'); end if;
      if v_val ->> 'phone' = 'invalid' then errs := array_append(errs, 'Teléfono inválido'); end if;
      if v_val ->> 'email' = 'taken' or v_val ->> 'employee_number' = 'taken' or v_val ->> 'username' = 'taken' then
        v_status := 'duplicate';
      end if;
    end if;
    if v_email is null and v_emp is null and v_user is null then
      errs := array_append(errs, 'Se necesita correo, número de empleado o usuario para poder entrar');
    end if;

    -- Duplicados dentro del mismo archivo
    if (v_email is not null and v_email = any (seen_email))
       or (v_emp is not null and (v_company::text || ':' || v_emp) = any (seen_emp))
       or (v_user is not null and v_user = any (seen_user)) then
      v_status := 'duplicate';
    end if;
    if v_email is not null then seen_email := seen_email || v_email; end if;
    if v_emp is not null then seen_emp := seen_emp || (v_company::text || ':' || v_emp); end if;
    if v_user is not null then seen_user := seen_user || v_user; end if;

    if array_length(errs, 1) > 0 then v_status := 'error'; end if;

    out := out || jsonb_build_array(jsonb_build_object(
      'row', i, 'status', v_status, 'errors', to_jsonb(errs),
      'data', v_payload, 'manager_ref', case when v_manager is null then v_manager_ref end
    ));
  end loop;
  return out;
end $$;
grant execute on function public.admin_validate_import(jsonb) to authenticated;

-- Después de crear los usuarios importados, liga a los jefes que venían en el mismo archivo.
create or replace function public.admin_link_managers(p_links jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  l jsonb;
  v_user public.profiles;
  v_manager uuid;
  v_linked int := 0;
  v_missing jsonb := '[]'::jsonb;
begin
  for l in select value from jsonb_array_elements(p_links) loop
    select * into v_user from public.profiles where id = (l ->> 'user_id')::uuid;
    if not found then continue; end if;
    perform app.assert_can('users.import', v_user.company_id, v_user.branch_id, v_user.department_id, v_user.id);
    select id into v_manager from public.profiles
     where status <> 'deleted' and id <> v_user.id
       and (lower(email) = lower(l ->> 'manager_ref')
            or (employee_number = (l ->> 'manager_ref') and company_id = v_user.company_id))
     limit 1;
    if v_manager is null then
      v_missing := v_missing || jsonb_build_array(l);
    else
      update public.profiles set manager_id = v_manager where id = v_user.id;
      v_linked := v_linked + 1;
    end if;
  end loop;
  return jsonb_build_object('linked', v_linked, 'missing', v_missing);
end $$;
grant execute on function public.admin_link_managers(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Funciones solo para el servidor (service_role)
-- ---------------------------------------------------------------------

-- Resuelve el identificador del login (correo, usuario o número de empleado) al correo de Auth.
-- Nunca se expone al navegador: solo la llama la Server Action de login.
create or replace function public.resolve_login(p_identifier text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id text := lower(trim(p_identifier));
  v_rows record;
  v_count int;
begin
  if v_id = '' then return null; end if;
  if position('@' in v_id) > 0 then
    select auth_email, status into v_rows from public.profiles
     where lower(email) = v_id or lower(auth_email) = v_id limit 1;
    return case when v_rows is null then null else jsonb_build_object('auth_email', v_rows.auth_email, 'status', v_rows.status) end;
  end if;
  select auth_email, status into v_rows from public.profiles where lower(username) = v_id limit 1;
  if found then
    return jsonb_build_object('auth_email', v_rows.auth_email, 'status', v_rows.status);
  end if;
  -- Número de empleado: solo si es único en todo el grupo (entre perfiles no eliminados).
  select count(*) into v_count from public.profiles where lower(employee_number) = v_id and status <> 'deleted';
  if v_count = 1 then
    select auth_email, status into v_rows from public.profiles where lower(employee_number) = v_id and status <> 'deleted';
    return jsonb_build_object('auth_email', v_rows.auth_email, 'status', v_rows.status);
  end if;
  return null;
end $$;
revoke execute on function public.resolve_login(text) from public, anon, authenticated;
grant execute on function public.resolve_login(text) to service_role;

-- Ventana fija: true = permitido.
create or replace function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  insert into app.rate_limits as rl (key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end,
    count = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.count + 1 end
  returning count into v_count;
  return v_count <= p_limit;
end $$;
revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

-- Bitácora de eventos del servidor (login fallido, invitaciones, cambios en Auth). p_actor puede ser nulo.
create or replace function public.server_log(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid default null, p_data jsonb default null
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.actor_id', coalesce(p_actor::text, ''), true);
  perform app.log(p_action, p_entity_type, p_entity_id,
    (select company_id from public.profiles where id = p_entity_id), null, p_data);
end $$;
revoke execute on function public.server_log(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.server_log(uuid, text, text, uuid, jsonb) to service_role;

-- Marca el login (último acceso) o que el usuario ya cambió su contraseña.
create or replace function public.server_mark_user(p_user_id uuid, p_event text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.actor_id', p_user_id::text, true);
  if p_event = 'login' then
    -- last_login_at no se audita como cambio de perfil; se registra como evento de login.
    update public.profiles set last_login_at = now() where id = p_user_id;
  elsif p_event = 'password_changed' then
    update public.profiles set must_change_password = false where id = p_user_id;
  elsif p_event = 'password_reset_by_admin' then
    update public.profiles set must_change_password = true where id = p_user_id;
  else
    perform app.fail('VALIDATION', 'event');
  end if;
end $$;
revoke execute on function public.server_mark_user(uuid, text) from public, anon, authenticated;
grant execute on function public.server_mark_user(uuid, text) to service_role;

-- Evento de sesión registrado por el propio usuario (login, logout).
create or replace function public.log_session_event(p_action text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_action not in ('auth.login', 'auth.logout', 'auth.mfa_verified', 'auth.mfa_enrolled') then
    perform app.fail('VALIDATION', 'action');
  end if;
  if (select auth.uid()) is null then perform app.fail('FORBIDDEN'); end if;
  perform app.log(p_action, 'user', (select auth.uid()), app.my_company_id());
end $$;
grant execute on function public.log_session_event(text) to authenticated;

-- ---------------------------------------------------------------------
-- Consulta de la bitácora (audit.read), filtrada por alcance
-- ---------------------------------------------------------------------
create or replace function public.search_audit(
  p_entity_type text default null, p_entity_id uuid default null, p_actor uuid default null,
  p_action text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_before_id bigint default null, p_limit int default 50
) returns table (
  id bigint, occurred_at timestamptz, actor_id uuid, actor_name text, actor_roles text[], action text,
  entity_type text, entity_id uuid, company_id uuid, old_data jsonb, new_data jsonb, ip text, user_agent text,
  sealed boolean
) language plpgsql stable security definer set search_path = ''
as $$
declare
  v_group boolean := app.can_group('audit.read');
  v_companies uuid[];
begin
  if not app.can_any('audit.read') then perform app.fail('FORBIDDEN', 'audit.read'); end if;
  select coalesce(array_agg(scope_id), '{}') into v_companies
    from app.my_grants() where permission_key = 'audit.read' and scope_type = 'company';
  return query
    select a.id, a.occurred_at, a.actor_id, ap.full_name, a.actor_roles, a.action, a.entity_type, a.entity_id,
           a.company_id, a.old_data, a.new_data, a.ip, a.user_agent, a.hash is not null
    from audit.audit_logs a
    left join public.profiles ap on ap.id = a.actor_id
    where (v_group or a.company_id = any (v_companies))
      and (p_entity_type is null or a.entity_type = p_entity_type)
      and (p_entity_id is null or a.entity_id = p_entity_id)
      and (p_actor is null or a.actor_id = p_actor)
      and (p_action is null or a.action like p_action || '%')
      and (p_from is null or a.occurred_at >= p_from)
      and (p_to is null or a.occurred_at < p_to)
      and (p_before_id is null or a.id < p_before_id)
    order by a.id desc
    limit least(greatest(p_limit, 1), 200);
end $$;
grant execute on function public.search_audit(text, uuid, uuid, text, timestamptz, timestamptz, bigint, int) to authenticated;
