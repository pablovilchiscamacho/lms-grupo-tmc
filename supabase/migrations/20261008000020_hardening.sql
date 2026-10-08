-- ============================================================================
-- 0020 · Endurecimiento (Fase 10)
-- 1) Mínimo privilegio en las funciones de la API: Postgres da EXECUTE a PUBLIC por omisión, así que
--    hasta hoy alguien sin sesión podía *llamar* las RPC (todas respondían FORBIDDEN por dentro).
--    Ahora sin sesión solo existe verify_certificate; el resto, solo usuarios autenticados.
-- 2) pg_net solo para la base (el envío de correo corre como dueño).
-- 3) Índices para llaves foráneas que sí se consultan.
-- 4) Salud del sistema para el Super Admin (jobs, correo, bitácora, tamaño).
-- ============================================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
grant execute on function public.verify_certificate(text) to anon;

-- Las funciones que se creen después nacen sin EXECUTE para PUBLIC (cada migración otorga lo necesario).
-- (El EXECUTE a PUBLIC es un privilegio global por omisión: se quita sin «in schema», para el rol que corre las migraciones.)
alter default privileges revoke execute on functions from public;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    execute 'revoke execute on all functions in schema net from public, anon, authenticated';
  end if;
end $$;

create index if not exists lesson_progress_lesson_idx on public.lesson_progress (lesson_id);
create index if not exists enrollments_assignment_idx on public.enrollments (assignment_id);
create index if not exists user_roles_role_idx on public.user_roles (role_id);
create index if not exists exam_pools_exam_idx on public.exam_pools (exam_id);
create index if not exists questions_supersedes_idx on public.questions (supersedes_id) where supersedes_id is not null;
create index if not exists course_prerequisites_required_idx on public.course_prerequisites (required_course_id);
create index if not exists email_outbox_user_idx on public.email_outbox (user_id);
create index if not exists compliance_snapshots_course_idx on public.compliance_snapshots (course_id);
create index if not exists certificates_company_idx on public.certificates (company_id);
create index if not exists assignments_rule_idx on public.assignments (course_id) where is_active and mode = 'rule';

-- ---------------------------------------------------------------------------
-- Salud del sistema (solo Super Admin / settings.manage de grupo)
-- ---------------------------------------------------------------------------
create or replace function public.system_health()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_jobs jsonb := '[]';
begin
  if not app.can_group('settings.manage') then perform app.fail('FORBIDDEN', 'settings.manage'); end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_status', r.status, 'last_start', r.start_time, 'last_message', left(r.return_message, 200),
        'failures_24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours'))
        order by j.jobname), '[]')
      from cron.job j
      left join lateral (select status, start_time, return_message from cron.job_run_details d where d.jobid = j.jobid order by start_time desc limit 1) r on true
    $q$ into v_jobs;
  end if;
  return jsonb_build_object(
    'jobs', v_jobs,
    'audit', jsonb_build_object('total', (select count(*) from audit.audit_logs), 'unsealed', (select count(*) from audit.audit_logs where hash is null),
                                'oldest_unsealed', (select min(occurred_at) from audit.audit_logs where hash is null)),
    'email', jsonb_build_object('pending', (select count(*) from public.email_outbox where status in ('pending', 'sending')),
                                'failed_24h', (select count(*) from public.email_outbox where status = 'failed' and created_at > now() - interval '24 hours'),
                                'oldest_pending', (select min(created_at) from public.email_outbox where status = 'pending')),
    'attempts_open', (select count(*) from public.exam_attempts where status = 'in_progress'),
    'attempts_overdue', (select count(*) from public.exam_attempts where status = 'in_progress' and deadline_at < now() - interval '5 minutes'),
    'users', jsonb_build_object('active', (select count(*) from public.profiles where status = 'active'),
                                'logins_7d', (select count(distinct actor_id) from audit.audit_logs where action = 'auth.login' and occurred_at > now() - interval '7 days'),
                                'failed_logins_24h', (select count(*) from audit.audit_logs where action = 'auth.login_failed' and occurred_at > now() - interval '24 hours')),
    'db_size_bytes', pg_database_size(current_database()),
    'checked_at', now());
end $$;
revoke execute on function public.system_health() from public, anon;
grant execute on function public.system_health() to authenticated;
