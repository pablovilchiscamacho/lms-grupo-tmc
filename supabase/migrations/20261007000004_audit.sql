-- =====================================================================
-- 0004 · Bitácora de auditoría (solo-agregar, con cadena de hash)
-- Nadie puede editar ni borrar filas. Un job "sella" las filas nuevas en orden
-- (hash = sha256(prev_hash || contenido)) sin bloquear las transacciones del negocio.
-- =====================================================================

create table audit.audit_logs (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  actor_roles text[],
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  company_id  uuid,
  old_data    jsonb,
  new_data    jsonb,
  ip          text,
  user_agent  text,
  request_id  text,
  prev_hash   text,
  hash        text
);
create index audit_logs_occurred_brin on audit.audit_logs using brin (occurred_at);
create index audit_logs_entity_idx on audit.audit_logs (entity_type, entity_id, id desc);
create index audit_logs_actor_idx on audit.audit_logs (actor_id, id desc);
create index audit_logs_company_idx on audit.audit_logs (company_id, id desc);
create index audit_logs_action_idx on audit.audit_logs (action, id desc);
create index audit_logs_unsealed_idx on audit.audit_logs (id) where hash is null;

-- Ningún rol de la aplicación puede leer o escribir directamente (service_role incluido).
revoke all on audit.audit_logs from public, anon, authenticated, service_role;

-- Inmutabilidad: solo se permite completar el sello (prev_hash/hash) de una fila que aún no lo tiene.
create or replace function audit.guard_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.hash is null and new.hash is not null
     and (to_jsonb(new) - 'hash' - 'prev_hash') = (to_jsonb(old) - 'hash' - 'prev_hash') then
    return new;
  end if;
  raise exception using errcode = 'P0001', message = 'AUDIT_IMMUTABLE';
end $$;
create trigger audit_logs_immutable before update or delete on audit.audit_logs
  for each row execute function audit.guard_immutable();
create trigger audit_logs_no_truncate before truncate on audit.audit_logs
  for each statement execute function audit.guard_immutable();

-- Registra un evento explícito (login, transiciones, etc.).
create or replace function app.log(
  p_action text, p_entity_type text, p_entity_id uuid default null, p_company_id uuid default null,
  p_old jsonb default null, p_new jsonb default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := app.actor_id();
begin
  insert into audit.audit_logs (actor_id, actor_roles, action, entity_type, entity_id, company_id,
                                old_data, new_data, ip, user_agent, request_id)
  values (
    v_actor,
    (select array_agg(distinct r.key) from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.user_id = v_actor and ur.revoked_at is null),
    p_action, p_entity_type, p_entity_id, p_company_id, p_old, p_new,
    left(coalesce(app.request_header('x-client-ip'), split_part(app.request_header('x-forwarded-for'), ',', 1)), 64),
    left(coalesce(app.request_header('x-client-ua'), app.request_header('user-agent')), 400),
    left(app.request_header('x-request-id'), 64)
  );
end $$;

-- Trigger genérico: guarda solo las columnas que cambiaron.
-- Uso: create trigger x_audit after insert or update or delete on t for each row execute function audit.capture('entity');
create or replace function audit.capture()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_entity text := coalesce(tg_argv[0], tg_table_name);
  v_ignore text[] := array['updated_at', 'search', 'full_name', 'last_login_at'];
  v_key text;
  v_action text;
  v_company uuid;
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any (v_ignore) or (v_new -> v_key) is not distinct from (v_old -> v_key) then
        v_new := v_new - v_key;
        v_old := v_old - v_key;
      end if;
    end loop;
    if v_new = '{}'::jsonb then
      return null; -- nada relevante cambió
    end if;
  end if;

  -- Nunca se guardan secretos en la bitácora.
  v_old := v_old - 'encrypted_password' - 'token';
  v_new := v_new - 'encrypted_password' - 'token';

  v_action := v_entity || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  v_company := case
    when tg_table_name = 'companies' then (v_row ->> 'id')::uuid
    when v_row ? 'company_id' then nullif(v_row ->> 'company_id', '')::uuid
  end;

  perform app.log(v_action, v_entity, nullif(v_row ->> 'id', '')::uuid, v_company, v_old, v_new);
  return null;
end $$;

-- Sella en orden las filas nuevas. Lo ejecuta pg_cron cada minuto (migración de jobs).
create or replace function audit.seal(p_limit int default 5000)
returns int language plpgsql security definer set search_path = '' set timezone = 'UTC'
as $$
declare
  v_prev text;
  v_row record;
  v_hash text;
  v_count int := 0;
begin
  -- Un solo sellador a la vez.
  if not pg_try_advisory_xact_lock(hashtext('audit.seal')) then
    return 0;
  end if;
  select hash into v_prev from audit.audit_logs where hash is not null order by id desc limit 1;
  for v_row in
    select * from audit.audit_logs where hash is null order by id limit p_limit
  loop
    v_hash := encode(sha256(convert_to(
      coalesce(v_prev, 'GENESIS') || '|' || (to_jsonb(v_row) - 'hash' - 'prev_hash')::text, 'UTF8')), 'hex');
    update audit.audit_logs set prev_hash = v_prev, hash = v_hash where id = v_row.id;
    v_prev := v_hash;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Verifica la cadena completa. Devuelve el primer id roto (null = íntegra).
create or replace function audit.verify_chain()
returns bigint language plpgsql stable security definer set search_path = '' set timezone = 'UTC'
as $$
declare
  v_prev text;
  v_row record;
begin
  for v_row in select * from audit.audit_logs where hash is not null order by id loop
    if v_row.prev_hash is distinct from v_prev
       or v_row.hash <> encode(sha256(convert_to(
            coalesce(v_prev, 'GENESIS') || '|' || (to_jsonb(v_row) - 'hash' - 'prev_hash')::text, 'UTF8')), 'hex') then
      return v_row.id;
    end if;
    v_prev := v_row.hash;
  end loop;
  return null;
end $$;

-- Tablas de la Fase 1 con auditoría automática
create trigger companies_audit   after insert or update or delete on public.companies   for each row execute function audit.capture('company');
create trigger branches_audit    after insert or update or delete on public.branches    for each row execute function audit.capture('branch');
create trigger departments_audit after insert or update or delete on public.departments for each row execute function audit.capture('department');
create trigger positions_audit   after insert or update or delete on public.positions   for each row execute function audit.capture('position');
create trigger profiles_audit    after insert or update or delete on public.profiles    for each row execute function audit.capture('user');
create trigger user_roles_audit  after insert or update or delete on public.user_roles  for each row execute function audit.capture('user_role');
create trigger user_groups_audit after insert or update or delete on public.user_groups for each row execute function audit.capture('user_group');
create trigger user_group_members_audit after insert or delete on public.user_group_members for each row execute function audit.capture('user_group_member');
create trigger settings_audit    after insert or update or delete on public.settings    for each row execute function audit.capture('setting');
create trigger role_permissions_audit after insert or delete on public.role_permissions for each row execute function audit.capture('role_permission');
