-- Importar personal sin cargar antes la estructura: si el Excel trae una sucursal, departamento o puesto que
-- no existe, la validación lo anuncia («se creará») y, al importar, admin_import_create_org lo da de alta
-- antes de crear a las personas. Solo para quien administra la empresa completa (org.manage, o users.import
-- con alcance de empresa o grupo); quien tiene alcance de sucursal o departamento sigue viendo el error.
-- La comparación ignora mayúsculas, acentos y espacios repetidos, para no duplicar «Almacen» / «Almacén».

-- Nombre limpio: sin espacios sobrantes.
create or replace function app.clean_name(p text)
returns text language sql immutable set search_path = ''
as $$ select regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g') $$;

create or replace function app.same_name(a text, b text)
returns boolean language sql immutable set search_path = ''
as $$ select app.norm(app.clean_name(a)) = app.norm(app.clean_name(b)) $$;

create or replace function app.can_create_org(p_company uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.can('org.manage', p_company) or app.can('users.import', p_company) $$;

-- Clave corta a partir del nombre («Capital Humano» → CAPHUM), única dentro de la empresa.
create or replace function app.org_code(p_table text, p_company uuid, p_name text)
returns text language plpgsql stable set search_path = ''
as $$
declare base text; code text; n int := 1; taken boolean;
begin
  select left(string_agg(left(w, 3), '' order by o), 12) into base
    from regexp_split_to_table(app.norm(p_name), '[^a-z0-9]+') with ordinality t(w, o) where w <> '';
  base := upper(coalesce(nullif(base, ''), 'X'));
  code := base;
  loop
    execute format('select exists (select 1 from public.%I where company_id = $1 and upper(code) = $2)', p_table) into taken using p_company, code;
    exit when not taken;
    n := n + 1; code := left(base, 17) || '-' || n;
  end loop;
  return code;
end $$;

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
  v_new jsonb;
  v_can_create boolean;
begin
  if not app.can_any('users.import') then perform app.fail('FORBIDDEN', 'users.import'); end if;
  if jsonb_array_length(p_rows) > 2000 then perform app.fail('IMPORT_TOO_LARGE'); end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    errs := '{}';
    v_status := 'valid';
    v_new := '[]'::jsonb;
    v_company := null; v_branch := null; v_dept := null; v_pos := null; v_manager := null; v_manager_ref := null; v_hire := null;
    v_email := nullif(lower(trim(r ->> 'email')), '');
    v_emp := nullif(trim(r ->> 'numero_empleado'), '');
    v_user := nullif(lower(trim(r ->> 'usuario')), '');

    select id into v_company from public.companies
     where is_active and (app.norm(short_name) = app.norm(r ->> 'empresa') or app.norm(name) = app.norm(r ->> 'empresa')) limit 1;
    if v_company is null then errs := array_append(errs, 'Empresa no encontrada'); end if;

    if v_company is not null then
      v_can_create := app.can_create_org(v_company);
      if nullif(trim(r ->> 'sucursal'), '') is not null then
        select id into v_branch from public.branches where company_id = v_company and is_active
          and (app.norm(code) = app.norm(r ->> 'sucursal') or app.same_name(name, r ->> 'sucursal')) limit 1;
        if v_branch is null then
          if v_can_create then v_new := v_new || jsonb_build_object('kind', 'branch', 'name', app.clean_name(r ->> 'sucursal'));
          else errs := array_append(errs, 'Sucursal no encontrada'); end if;
        end if;
      end if;
      if nullif(trim(r ->> 'departamento'), '') is not null then
        select id into v_dept from public.departments where company_id = v_company and is_active
          and (app.norm(code) = app.norm(r ->> 'departamento') or app.same_name(name, r ->> 'departamento')) limit 1;
        if v_dept is null then
          if v_can_create then v_new := v_new || jsonb_build_object('kind', 'department', 'name', app.clean_name(r ->> 'departamento'));
          else errs := array_append(errs, 'Departamento no encontrado'); end if;
        end if;
      end if;
      if nullif(trim(r ->> 'puesto'), '') is not null then
        select id into v_pos from public.positions where company_id = v_company and is_active
          and (app.norm(code) = app.norm(r ->> 'puesto') or app.same_name(name, r ->> 'puesto')) limit 1;
        if v_pos is null then
          if v_can_create then v_new := v_new || jsonb_build_object('kind', 'position', 'name', app.clean_name(r ->> 'puesto'));
          else errs := array_append(errs, 'Puesto no encontrado'); end if;
        end if;
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

    if exists (select 1 from jsonb_array_elements(v_new) x where char_length(x ->> 'name') < 2) then
      errs := array_append(errs, 'Nombre de sucursal, departamento o puesto demasiado corto');
    end if;
    if array_length(errs, 1) > 0 then v_status := 'error'; end if;

    out := out || jsonb_build_array(jsonb_build_object(
      'row', i, 'status', v_status, 'errors', to_jsonb(errs), 'new_org', v_new,
      'data', v_payload, 'manager_ref', case when v_manager is null then v_manager_ref end
    ));
  end loop;
  return out;
end $$;
grant execute on function public.admin_validate_import(jsonb) to authenticated;
grant execute on function public.admin_validate_import(jsonb) to authenticated;

-- Da de alta lo que falte (sucursales, departamentos, puestos) para las filas que se van a importar.
-- Un puesto nuevo queda ligado al departamento de la primera fila en que aparece.
create or replace function public.admin_import_create_org(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb; v_company uuid; v_dept uuid; v_id uuid; v_name text;
  made jsonb := jsonb_build_object('branch', '[]'::jsonb, 'department', '[]'::jsonb, 'position', '[]'::jsonb);
begin
  if not app.can_any('users.import') then perform app.fail('FORBIDDEN', 'users.import'); end if;
  if jsonb_array_length(p_rows) > 2000 then perform app.fail('IMPORT_TOO_LARGE'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    select id into v_company from public.companies
     where is_active and (app.norm(short_name) = app.norm(r ->> 'empresa') or app.norm(name) = app.norm(r ->> 'empresa')) limit 1;
    continue when v_company is null or not app.can_create_org(v_company);

    v_name := app.clean_name(r ->> 'sucursal');
    if char_length(v_name) >= 2 and not exists (select 1 from public.branches where company_id = v_company and is_active
         and (app.norm(code) = app.norm(v_name) or app.same_name(name, v_name))) then
      insert into public.branches (company_id, name, code, created_by)
      values (v_company, v_name, app.org_code('branches', v_company, v_name), auth.uid());
      made := jsonb_set(made, '{branch}', (made -> 'branch') || to_jsonb(v_name));
    end if;

    v_dept := null;
    v_name := app.clean_name(r ->> 'departamento');
    if char_length(v_name) >= 2 then
      select id into v_dept from public.departments where company_id = v_company and is_active
         and (app.norm(code) = app.norm(v_name) or app.same_name(name, v_name)) limit 1;
      if v_dept is null then
        insert into public.departments (company_id, name, code, created_by)
        values (v_company, v_name, app.org_code('departments', v_company, v_name), auth.uid()) returning id into v_dept;
        made := jsonb_set(made, '{department}', (made -> 'department') || to_jsonb(v_name));
      end if;
    end if;

    v_name := app.clean_name(r ->> 'puesto');
    if char_length(v_name) >= 2 and not exists (select 1 from public.positions where company_id = v_company and is_active
         and (app.norm(code) = app.norm(v_name) or app.same_name(name, v_name))) then
      insert into public.positions (company_id, department_id, name, code, created_by)
      values (v_company, v_dept, v_name, app.org_code('positions', v_company, v_name), auth.uid());
      made := jsonb_set(made, '{position}', (made -> 'position') || to_jsonb(v_name));
    end if;
  end loop;
  if made <> jsonb_build_object('branch', '[]'::jsonb, 'department', '[]'::jsonb, 'position', '[]'::jsonb) then
    perform app.log('org.created_by_import', 'organization', null, null, null, made);
  end if;
  return made;
end $$;
grant execute on function public.admin_import_create_org(jsonb) to authenticated;
