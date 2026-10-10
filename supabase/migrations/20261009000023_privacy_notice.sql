-- ============================================================================
-- 0023 · Aviso de privacidad que se acepta al ingresar (LFPDPPP)
-- Cada empresa (responsable) puede tener su aviso; si no tiene, aplica el del grupo (company_id nulo).
-- Al publicar una versión nueva, todos deben aceptarla de nuevo. Las aceptaciones no se pueden cambiar ni borrar.
-- El texto admite {{empresa}} (razón social o nombre de la empresa de la persona) y {{fecha}} (publicación).
-- No se puede publicar con datos pendientes entre corchetes, por ejemplo [DOMICILIO].
-- ============================================================================

create table public.privacy_notices (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies (id),
  version      int,
  title        text not null check (char_length(trim(title)) between 3 and 200),
  body         text not null check (char_length(body) between 50 and 60000),
  status       text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  constraint privacy_notices_published_version check (status = 'draft' or (version is not null and published_at is not null))
);
create unique index privacy_notices_one_published on public.privacy_notices (company_id) nulls not distinct where status = 'published';
create unique index privacy_notices_one_draft on public.privacy_notices (company_id) nulls not distinct where status = 'draft';
create unique index privacy_notices_version on public.privacy_notices (company_id, version) nulls not distinct where version is not null;
alter table public.privacy_notices enable row level security;
revoke all on public.privacy_notices from anon, authenticated;   -- solo por RPC
create trigger privacy_notices_audit after insert or update on public.privacy_notices for each row execute function audit.capture('privacy_notice');
create trigger privacy_notices_no_delete before delete on public.privacy_notices for each row execute function app.guard_no_delete();

create table public.privacy_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id),
  notice_id   uuid not null references public.privacy_notices (id),
  accepted_at timestamptz not null default now(),
  ip          text,
  user_agent  text,
  constraint privacy_acceptances_once unique (user_id, notice_id)
);
create index privacy_acceptances_notice_idx on public.privacy_acceptances (notice_id);
alter table public.privacy_acceptances enable row level security;
revoke all on public.privacy_acceptances from anon, authenticated;
grant select on public.privacy_acceptances to authenticated;
create policy privacy_acceptances_select on public.privacy_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or app.can_user('users.read', user_id));
create trigger privacy_acceptances_no_delete before delete on public.privacy_acceptances for each row execute function app.guard_no_delete();
create or replace function app.guard_no_update()
returns trigger language plpgsql set search_path = ''
as $$ begin perform app.fail('IMMUTABLE', tg_table_name); return null; end $$;
create trigger privacy_acceptances_no_update before update on public.privacy_acceptances for each row execute function app.guard_no_update();

-- Aviso vigente que aplica a una persona: el de su empresa, si no el del grupo.
create or replace function app.applicable_privacy_notice(p_user uuid)
returns public.privacy_notices language sql stable security definer set search_path = ''
as $$
  select n.* from public.privacy_notices n
  where n.status = 'published'
    and (n.company_id = (select company_id from public.profiles where id = p_user) or n.company_id is null)
  order by (n.company_id is null), n.published_at desc
  limit 1
$$;

create or replace function app.privacy_pending(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select n.id is not null and not exists (select 1 from public.privacy_acceptances a where a.user_id = p_user and a.notice_id = n.id)
  from app.applicable_privacy_notice(p_user) n
$$;

create or replace function app.render_privacy(n public.privacy_notices, p_company uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select replace(replace(n.body, '{{empresa}}', coalesce((select coalesce(nullif(legal_name, ''), name) from public.companies where id = p_company), 'la empresa')),
                 '{{fecha}}', to_char(coalesce(n.published_at, now()) at time zone 'America/Mexico_City', 'DD/MM/YYYY'))
$$;

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
    'aal', app.session_aal(),
    'privacy_pending', app.privacy_pending(p.id)
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

-- Lo que ve la persona al ingresar (o nada si ya aceptó).
create or replace function public.my_pending_privacy_notice()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare n public.privacy_notices; v_company uuid;
begin
  select company_id into v_company from public.profiles where id = (select auth.uid());
  n := app.applicable_privacy_notice((select auth.uid()));
  if n.id is null or not app.privacy_pending((select auth.uid())) then return null; end if;
  return jsonb_build_object('id', n.id, 'version', n.version, 'title', n.title, 'body', app.render_privacy(n, v_company),
    'company', (select coalesce(nullif(legal_name, ''), name) from public.companies where id = v_company), 'published_at', n.published_at);
end $$;
grant execute on function public.my_pending_privacy_notice() to authenticated;

create or replace function public.accept_privacy_notice(p_notice uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare n public.privacy_notices; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then perform app.fail('FORBIDDEN'); end if;
  n := app.applicable_privacy_notice(v_uid);
  if n.id is null or n.id <> p_notice then perform app.fail('VALIDATION', '{"notice":"outdated"}'); end if;
  insert into public.privacy_acceptances (user_id, notice_id, ip, user_agent)
  values (v_uid, p_notice, app.request_header('x-client-ip'), left(app.request_header('x-client-ua'), 300))
  on conflict (user_id, notice_id) do nothing;
  perform app.log('privacy.accepted', 'privacy_notice', p_notice, (select company_id from public.profiles where id = v_uid), null,
    jsonb_build_object('version', n.version));
end $$;
grant execute on function public.accept_privacy_notice(uuid) to authenticated;

-- Administración (Super Admin): borrador y publicación.
create or replace function public.save_privacy_notice_draft(p_company uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  if not app.can_group('settings.manage') then perform app.fail('FORBIDDEN', 'settings.manage'); end if;
  update public.privacy_notices set title = trim(p_title), body = p_body, updated_at = now()
  where status = 'draft' and company_id is not distinct from p_company returning id into v;
  if v is null then
    insert into public.privacy_notices (company_id, title, body, created_by) values (p_company, trim(p_title), p_body, app.actor_id()) returning id into v;
  end if;
  return v;
end $$;
grant execute on function public.save_privacy_notice_draft(uuid, text, text) to authenticated;

create or replace function public.publish_privacy_notice(p_id uuid)
returns int language plpgsql security definer set search_path = ''
as $$
declare n public.privacy_notices; v_version int;
begin
  if not app.can_group('settings.manage') then perform app.fail('FORBIDDEN', 'settings.manage'); end if;
  select * into n from public.privacy_notices where id = p_id and status = 'draft' for update;
  if not found then perform app.fail('NOT_FOUND', 'privacy_notice'); end if;
  if n.body ~ '\[[A-ZÁÉÍÓÚÑ ]{3,}\]' or n.title ~ '\[[A-ZÁÉÍÓÚÑ ]{3,}\]' then
    perform app.fail('VALIDATION', '{"body":"placeholders"}');
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.privacy_notices where company_id is not distinct from n.company_id;
  update public.privacy_notices set status = 'retired' where status = 'published' and company_id is not distinct from n.company_id;
  update public.privacy_notices set status = 'published', version = v_version, published_at = now(), published_by = app.actor_id() where id = p_id;
  return v_version;
end $$;
grant execute on function public.publish_privacy_notice(uuid) to authenticated;

-- Para la pantalla de administración: avisos (vigente y borrador) y cuántos aceptaron en el alcance de quien consulta.
create or replace function public.privacy_overview()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not (app.can_any('users.read') or app.can_group('settings.manage')) then perform app.fail('FORBIDDEN', 'users.read'); end if;
  with people as (select id, company_id, full_name, employee_number from app.dash_people('users.read', '{}')),
  st as (
    select p.*, n.id notice_id, n.version, exists (select 1 from public.privacy_acceptances a where a.user_id = p.id and a.notice_id = n.id) accepted,
           (select a.accepted_at from public.privacy_acceptances a where a.user_id = p.id and a.notice_id = n.id) accepted_at
    from people p left join lateral app.applicable_privacy_notice(p.id) n on true
  )
  select jsonb_build_object(
    'can_edit', app.can_group('settings.manage'),
    'notices', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'company_id', n.company_id,
        'company', (select name from public.companies where id = n.company_id), 'version', n.version, 'status', n.status,
        'title', n.title, 'body', n.body, 'published_at', n.published_at, 'updated_at', n.updated_at)
        order by n.company_id nulls first, n.status)
      from public.privacy_notices n where n.status in ('draft', 'published')
        and (app.can_group('settings.manage') or n.company_id is null or n.company_id in (select company_id from people))), '[]'),
    'total', (select count(*) from st where notice_id is not null),
    'accepted', (select count(*) from st where accepted),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'employee_number', employee_number) order by full_name)
                         from (select * from st where notice_id is not null and not accepted limit 200) x), '[]'))
  into v;
  return v;
end $$;
grant execute on function public.privacy_overview() to authenticated;
