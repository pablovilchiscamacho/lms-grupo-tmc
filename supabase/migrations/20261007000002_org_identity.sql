-- =====================================================================
-- 0002 · Organización e identidad
-- Grupo (una sola instalación) → empresas → sucursales / departamentos / puestos → usuarios
-- =====================================================================

create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  short_name    text not null,
  legal_name    text,
  rfc           text,
  logo_file_id  uuid,
  timezone      text not null default 'America/Mexico_City',
  primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  is_active     boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint companies_name_key unique (name),
  constraint companies_short_name_key unique (short_name),
  constraint companies_name_len check (char_length(trim(name)) between 2 and 120)
);

create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  name        text not null check (char_length(trim(name)) between 2 and 120),
  code        text not null check (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  city        text,
  state       text,
  timezone    text,
  is_active   boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint branches_company_code_key unique (company_id, code)
);
create index branches_company_idx on public.branches (company_id);

create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  parent_id       uuid references public.departments (id) on delete restrict,
  name            text not null check (char_length(trim(name)) between 2 and 120),
  code            text not null check (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  functional_area text,
  head_user_id    uuid,
  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint departments_company_code_key unique (company_id, code),
  constraint departments_not_self_parent check (parent_id is null or parent_id <> id)
);
create index departments_company_idx on public.departments (company_id);
create index departments_parent_idx on public.departments (parent_id);

create table public.positions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  name          text not null check (char_length(trim(name)) between 2 and 120),
  code          text not null check (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  is_active     boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint positions_company_code_key unique (company_id, code)
);
create index positions_company_idx on public.positions (company_id);
create index positions_department_idx on public.positions (department_id);

-- Archivos (la subida segura se implementa en la Fase 2; la tabla existe desde ya por las FKs de logo y foto)
create table public.files (
  id                  uuid primary key default gen_random_uuid(),
  bucket              text not null check (bucket in ('course-content', 'avatars', 'certificates', 'imports', 'branding')),
  storage_path        text not null,
  original_name       text not null,
  extension           text not null,
  mime_type           text not null,
  size_bytes          bigint not null check (size_bytes > 0),
  sha256              text,
  status              public.file_status not null default 'pending_upload',
  version             int not null default 1,
  previous_version_id uuid references public.files (id),
  media_duration_s    int,
  page_count          int,
  course_id           uuid,
  uploaded_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint files_path_key unique (bucket, storage_path)
);

alter table public.companies add constraint companies_logo_fk foreign key (logo_file_id) references public.files (id);

-- ---------------------------------------------------------------------
-- Perfiles (1:1 con auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete restrict,
  employee_number    text check (employee_number ~ '^[A-Za-z0-9_-]{1,30}$'),
  username           text check (username ~ '^[a-z0-9._-]{3,40}$'),
  first_name         text not null check (char_length(trim(first_name)) between 1 and 80),
  last_name_paternal text not null check (char_length(trim(last_name_paternal)) between 1 and 80),
  last_name_maternal text check (last_name_maternal is null or char_length(trim(last_name_maternal)) between 1 and 80),
  email              text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  auth_email         text not null,
  has_real_email     boolean not null default true,
  phone              text check (phone is null or phone ~ '^[0-9 +()-]{7,20}$'),
  company_id         uuid not null references public.companies (id) on delete restrict,
  branch_id          uuid references public.branches (id) on delete restrict,
  department_id      uuid references public.departments (id) on delete restrict,
  position_id        uuid references public.positions (id) on delete restrict,
  manager_id         uuid references public.profiles (id) on delete restrict,
  hire_date          date,
  status             public.user_status not null default 'active',
  status_reason      text,
  status_changed_at  timestamptz,
  photo_file_id      uuid references public.files (id),
  must_change_password boolean not null default false,
  last_login_at      timestamptz,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid,
  full_name          text generated always as (
    trim(first_name || ' ' || last_name_paternal || coalesce(' ' || last_name_maternal, ''))
  ) stored,
  search             text generated always as (
    app.norm(first_name || ' ' || last_name_paternal || ' ' || coalesce(last_name_maternal, '') || ' ' ||
             coalesce(employee_number, '') || ' ' || coalesce(email, '') || ' ' || coalesce(username, ''))
  ) stored,
  constraint profiles_not_own_manager check (manager_id is null or manager_id <> id),
  constraint profiles_real_email_present check (not has_real_email or email is not null),
  constraint profiles_deleted_consistency check ((status = 'deleted') = (deleted_at is not null))
);
create unique index profiles_email_key on public.profiles (lower(email)) where email is not null;
create unique index profiles_auth_email_key on public.profiles (lower(auth_email));
create unique index profiles_username_key on public.profiles (lower(username)) where username is not null;
create unique index profiles_company_employee_key on public.profiles (company_id, employee_number) where employee_number is not null;
create index profiles_company_status_idx on public.profiles (company_id, status);
create index profiles_branch_idx on public.profiles (branch_id);
create index profiles_department_idx on public.profiles (department_id);
create index profiles_position_idx on public.profiles (position_id);
create index profiles_manager_idx on public.profiles (manager_id);
create index profiles_employee_number_idx on public.profiles (employee_number);
create index profiles_search_trgm on public.profiles using gin (search extensions.gin_trgm_ops);

alter table public.departments add constraint departments_head_fk foreign key (head_user_id) references public.profiles (id);

-- Cierre transitivo de la línea de reporte (incluye la fila propia con depth = 0).
create table public.profile_hierarchy (
  ancestor_id   uuid not null references public.profiles (id) on delete cascade,
  descendant_id uuid not null references public.profiles (id) on delete cascade,
  depth         int not null check (depth >= 0),
  primary key (ancestor_id, descendant_id)
);
create index profile_hierarchy_descendant_idx on public.profile_hierarchy (descendant_id);

-- Grupos ad hoc (destino de asignaciones en la Fase 4)
create table public.user_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 120),
  description text,
  company_id  uuid references public.companies (id),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table public.user_group_members (
  group_id uuid not null references public.user_groups (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete restrict,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index user_group_members_user_idx on public.user_group_members (user_id);

-- Configuración global (company_id nulo) y por empresa
create table public.settings (
  id         uuid primary key default gen_random_uuid(),
  key        text not null check (key ~ '^[a-z0-9_.]+$'),
  company_id uuid references public.companies (id),
  value      jsonb not null,
  is_private boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index settings_key_company_key on public.settings (key, coalesce(company_id, '00000000-0000-0000-0000-000000000000'));

-- Límite de peticiones (login, verificación pública, exportaciones)
create table app.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        int not null
);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create trigger companies_updated_at   before update on public.companies   for each row execute function app.set_updated_at();
create trigger branches_updated_at    before update on public.branches    for each row execute function app.set_updated_at();
create trigger departments_updated_at before update on public.departments for each row execute function app.set_updated_at();
create trigger positions_updated_at   before update on public.positions   for each row execute function app.set_updated_at();
create trigger files_updated_at       before update on public.files       for each row execute function app.set_updated_at();
create trigger profiles_updated_at    before update on public.profiles    for each row execute function app.set_updated_at();
create trigger user_groups_updated_at before update on public.user_groups for each row execute function app.set_updated_at();

-- La sucursal, el departamento y el puesto deben ser de la misma empresa que el registro.
create or replace function app.check_same_company()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_company uuid := new.company_id;
begin
  if tg_table_name = 'profiles' then
    if new.branch_id is not null and not exists (select 1 from public.branches where id = new.branch_id and company_id = v_company) then
      perform app.fail('ORG_MISMATCH', 'branch');
    end if;
    if new.department_id is not null and not exists (select 1 from public.departments where id = new.department_id and company_id = v_company) then
      perform app.fail('ORG_MISMATCH', 'department');
    end if;
    if new.position_id is not null and not exists (select 1 from public.positions where id = new.position_id and company_id = v_company) then
      perform app.fail('ORG_MISMATCH', 'position');
    end if;
  elsif tg_table_name = 'positions' then
    if new.department_id is not null and not exists (select 1 from public.departments where id = new.department_id and company_id = v_company) then
      perform app.fail('ORG_MISMATCH', 'department');
    end if;
  elsif tg_table_name = 'departments' then
    if new.parent_id is not null and not exists (select 1 from public.departments where id = new.parent_id and company_id = v_company) then
      perform app.fail('ORG_MISMATCH', 'parent');
    end if;
  end if;
  return new;
end $$;

create trigger profiles_same_company before insert or update of company_id, branch_id, department_id, position_id
  on public.profiles for each row execute function app.check_same_company();
create trigger positions_same_company before insert or update of company_id, department_id
  on public.positions for each row execute function app.check_same_company();
create trigger departments_same_company before insert or update of company_id, parent_id
  on public.departments for each row execute function app.check_same_company();

-- Sin ciclos en sub-áreas de departamentos.
create or replace function app.check_department_cycle()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive up as (
      select id, parent_id from public.departments where id = new.parent_id
      union all
      select d.id, d.parent_id from public.departments d join up on d.id = up.parent_id
    ) select 1 from up where id = new.id
  ) then
    perform app.fail('HIERARCHY_CYCLE');
  end if;
  return new;
end $$;
create trigger departments_no_cycle before insert or update of parent_id
  on public.departments for each row execute function app.check_department_cycle();

-- Mantiene profile_hierarchy (closure table) y evita ciclos en la línea de reporte.
create or replace function app.maintain_profile_hierarchy()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profile_hierarchy (ancestor_id, descendant_id, depth) values (new.id, new.id, 0);
    if new.manager_id is not null then
      insert into public.profile_hierarchy (ancestor_id, descendant_id, depth)
      select h.ancestor_id, new.id, h.depth + 1
      from public.profile_hierarchy h where h.descendant_id = new.manager_id;
    end if;
    return new;
  end if;

  -- UPDATE de manager_id
  if new.manager_id is not distinct from old.manager_id then
    return new;
  end if;
  if new.manager_id is not null and exists (
    select 1 from public.profile_hierarchy where ancestor_id = new.id and descendant_id = new.manager_id
  ) then
    perform app.fail('HIERARCHY_CYCLE');
  end if;

  -- Desconecta el subárbol de sus ancestros anteriores…
  delete from public.profile_hierarchy h
  where h.descendant_id in (select descendant_id from public.profile_hierarchy where ancestor_id = new.id)
    and h.ancestor_id in (select ancestor_id from public.profile_hierarchy where descendant_id = new.id and ancestor_id <> new.id);

  -- …y lo cuelga del nuevo jefe.
  if new.manager_id is not null then
    insert into public.profile_hierarchy (ancestor_id, descendant_id, depth)
    select sup.ancestor_id, sub.descendant_id, sup.depth + sub.depth + 1
    from public.profile_hierarchy sup
    cross join public.profile_hierarchy sub
    where sup.descendant_id = new.manager_id and sub.ancestor_id = new.id;
  end if;
  return new;
end $$;

create trigger profiles_hierarchy_ins after insert on public.profiles
  for each row execute function app.maintain_profile_hierarchy();
create trigger profiles_hierarchy_upd after update of manager_id on public.profiles
  for each row execute function app.maintain_profile_hierarchy();
