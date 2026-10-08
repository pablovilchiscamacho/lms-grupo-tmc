-- ============================================================================
-- 0014 · Tableros (Fase 5)
-- Cumplimiento por persona, área y curso, KPIs, actividad y foto diaria.
-- Todas las funciones aplican el alcance del usuario UNA vez (app.scope_profiles)
-- y nunca devuelven datos fuera de él: un jefe ve su equipo, RH su empresa, Dirección todo.
--
-- Definiciones (solo inscripciones activas y obligatorias de personas activas):
--   completado = terminó el curso (y aprobó si tiene examen)
--   reprobado  = agotó intentos sin aprobar
--   vencido    = no terminado, no reprobado y pasó la fecha límite
--   pendiente  = el resto (en tiempo)
--   cumplimiento = completados / asignados
-- ============================================================================

-- Departamento y todos sus hijos.
create or replace function app.department_descendants(p_department uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  with recursive d as (
    select id from public.departments where id = p_department
    union
    select c.id from public.departments c join d on c.parent_id = d.id
  ) select coalesce(array_agg(id), '{}') from d
$$;

-- Personas (cualquier estado) sobre las que el usuario actual tiene el permiso.
create or replace function app.scope_profiles(p_perm text)
returns table (id uuid) language sql stable security definer set search_path = ''
as $$
  with recursive g as (
    select scope_type, scope_id from app.my_grants() where permission_key = p_perm
  ), dep as (
    select d.id from public.departments d join g on g.scope_type = 'department' and d.id = g.scope_id
    union
    select c.id from public.departments c join dep on c.parent_id = dep.id
  )
  select p.id from public.profiles p
  where exists (select 1 from g where g.scope_type = 'group')
     or p.company_id in (select g.scope_id from g where g.scope_type = 'company')
     or p.branch_id in (select g.scope_id from g where g.scope_type = 'branch')
     or p.department_id in (select dep.id from dep)
     or (exists (select 1 from g where g.scope_type = 'team')
         and p.id in (select h.descendant_id from public.profile_hierarchy h where h.ancestor_id = (select auth.uid()) and h.depth > 0))
$$;

-- Personas del tablero: alcance ∩ filtros. Filtros (jsonb): company_id, branch_id, department_id (incluye sub-áreas),
-- position_id, manager_id (toda su línea de reporte), q (nombre o número). p_any_status incluye inactivos.
create or replace function app.dash_people(p_perm text, f jsonb, p_any_status boolean default false)
returns table (id uuid, full_name text, employee_number text, company_id uuid, branch_id uuid, department_id uuid, position_id uuid, status public.user_status)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.full_name, p.employee_number, p.company_id, p.branch_id, p.department_id, p.position_id, p.status
  from public.profiles p
  where p.id in (select s.id from app.scope_profiles(p_perm) s)
    and (case when p_any_status then p.status <> 'deleted' else p.status = 'active' end)
    and (nullif(f ->> 'company_id', '') is null or p.company_id = (f ->> 'company_id')::uuid)
    and (nullif(f ->> 'branch_id', '') is null or p.branch_id = (f ->> 'branch_id')::uuid)
    and (nullif(f ->> 'department_id', '') is null or p.department_id = any (app.department_descendants((f ->> 'department_id')::uuid)))
    and (nullif(f ->> 'position_id', '') is null or p.position_id = (f ->> 'position_id')::uuid)
    and (nullif(f ->> 'manager_id', '') is null or p.id in (
          select h.descendant_id from public.profile_hierarchy h where h.ancestor_id = (f ->> 'manager_id')::uuid and h.depth > 0))
    and (nullif(trim(f ->> 'q'), '') is null
         or app.norm(p.full_name) like '%' || app.norm(f ->> 'q') || '%'
         or p.employee_number ilike trim(f ->> 'q') || '%')
$$;

-- Inscripciones del tablero, ya clasificadas. Filtros extra: course_id, from / to (fecha de asignación).
create or replace function app.dash_enrollments(p_perm text, f jsonb)
returns table (id uuid, user_id uuid, course_id uuid, bucket text, due_week boolean, result public.enrollment_result,
               final_score numeric, total_seconds int, assigned_at timestamptz, due_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.user_id, e.course_id,
    case
      when e.progress_status = 'completed' then 'completed'
      when e.result = 'failed' then 'failed'
      when e.due_at is not null and e.due_at < now() then 'overdue'
      else 'pending' end,
    e.progress_status <> 'completed' and e.result <> 'failed' and e.due_at >= now() and e.due_at < now() + interval '7 days',
    e.result, e.final_score, e.total_seconds, e.assigned_at, e.due_at
  from public.enrollments e
  join app.dash_people(p_perm, f) p on p.id = e.user_id
  where e.state = 'active' and e.requirement = 'mandatory'
    and (nullif(f ->> 'course_id', '') is null or e.course_id = (f ->> 'course_id')::uuid)
    and (nullif(f ->> 'from', '') is null or e.assigned_at >= (f ->> 'from')::date)
    and (nullif(f ->> 'to', '') is null or e.assigned_at < (f ->> 'to')::date + 1)
$$;

create or replace function app.pct(p_num numeric, p_den numeric)
returns numeric language sql immutable set search_path = ''
as $$ select case when coalesce(p_den, 0) = 0 then null else round(p_num * 100.0 / p_den, 1) end $$;

-- ---------------------------------------------------------------------------
-- KPIs y "Requiere atención"
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary(f jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare r jsonb; u jsonb; h jsonb;
begin
  if not app.can_any('progress.read') then perform app.fail('FORBIDDEN', 'progress.read'); end if;
  f := coalesce(f, '{}');

  select jsonb_build_object(
    'total', count(*), 'active', count(*) filter (where status = 'active'),
    'inactive', count(*) filter (where status in ('inactive', 'suspended')))
  into u from app.dash_people('progress.read', f, true);

  select jsonb_build_object(
    'assigned', count(*),
    'completed', count(*) filter (where bucket = 'completed'),
    'failed', count(*) filter (where bucket = 'failed'),
    'overdue', count(*) filter (where bucket = 'overdue'),
    'pending', count(*) filter (where bucket = 'pending'),
    'due_week', count(*) filter (where due_week),
    'failed_people', count(distinct user_id) filter (where bucket = 'failed'),
    'overdue_people', count(distinct user_id) filter (where bucket = 'overdue'),
    'people_with_courses', count(distinct user_id),
    'compliance', app.pct(count(*) filter (where bucket = 'completed'), count(*)),
    'avg_score', round(avg(final_score) filter (where result in ('passed', 'failed')), 1),
    'pass_rate', app.pct(count(*) filter (where result = 'passed'), count(*) filter (where result in ('passed', 'failed'))),
    'fail_rate', app.pct(count(*) filter (where result = 'failed'), count(*) filter (where result in ('passed', 'failed'))))
  into r from app.dash_enrollments('progress.read', f);

  -- Horas: todo el tiempo dedicado (también cursos opcionales y ciclos anteriores), de personas activas en el alcance.
  select jsonb_build_object(
    'total', round(coalesce(sum(e.total_seconds), 0) / 3600.0, 1),
    'per_person', round(coalesce(sum(e.total_seconds), 0) / 3600.0 / nullif(count(distinct e.user_id), 0), 1))
  into h
  from public.enrollments e join app.dash_people('progress.read', f) p on p.id = e.user_id
  where e.state <> 'cancelled' and (nullif(f ->> 'course_id', '') is null or e.course_id = (f ->> 'course_id')::uuid);

  return jsonb_build_object('users', u, 'enrollments', r, 'hours', h);
end $$;
grant execute on function public.dashboard_summary(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Cumplimiento por persona (tabla con semáforo, paginada en el servidor)
-- f.light: green (>= 90), amber (70–89), red (< 70), none (sin cursos); f.only_overdue
-- p_sort: compliance (peor primero), -compliance (mejor primero), name, overdue
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_people(f jsonb default '{}', p_sort text default 'compliance', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not app.can_any('progress.read') then perform app.fail('FORBIDDEN', 'progress.read'); end if;
  f := coalesce(f, '{}');
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 500);

  with agg as (
    select e.user_id,
      count(*) as assigned,
      count(*) filter (where bucket = 'completed') as completed,
      count(*) filter (where bucket = 'pending') as pending,
      count(*) filter (where bucket = 'overdue') as overdue,
      count(*) filter (where bucket = 'failed') as failed,
      round(avg(final_score) filter (where result in ('passed', 'failed')), 1) as avg_score
    from app.dash_enrollments('progress.read', f) e group by e.user_id
  ), rows as (
    select p.id, p.full_name, p.employee_number,
      c.short_name as company, b.name as branch, d.name as department, po.name as position,
      coalesce(a.assigned, 0) as assigned, coalesce(a.completed, 0) as completed, coalesce(a.pending, 0) as pending,
      coalesce(a.overdue, 0) as overdue, coalesce(a.failed, 0) as failed, a.avg_score,
      app.pct(a.completed, a.assigned) as compliance
    from app.dash_people('progress.read', f) p
    join public.companies c on c.id = p.company_id
    left join public.branches b on b.id = p.branch_id
    left join public.departments d on d.id = p.department_id
    left join public.positions po on po.id = p.position_id
    left join agg a on a.user_id = p.id
    -- Con filtro de curso o de fechas solo cuenta quien tiene inscripciones que coinciden.
    where (a.user_id is not null or (nullif(f ->> 'course_id', '') is null and nullif(f ->> 'from', '') is null and nullif(f ->> 'to', '') is null))
  ), filtered as (
    select * from rows
    where (nullif(f ->> 'light', '') is null
           or (f ->> 'light' = 'green' and compliance >= 90)
           or (f ->> 'light' = 'amber' and compliance >= 70 and compliance < 90)
           or (f ->> 'light' = 'red' and compliance < 70)
           or (f ->> 'light' = 'none' and assigned = 0))
      and (coalesce((f ->> 'only_overdue')::boolean, false) = false or overdue > 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) - 'k1' - 'k2' order by x.k1, x.k2, x.full_name) from (
        select filtered.*,
          case p_sort
            when '-compliance' then -coalesce(compliance, -1)
            when 'overdue' then -overdue
            when 'name' then 0
            else coalesce(compliance, 1000) end as k1,
          case p_sort when '-compliance' then -coalesce(avg_score, -1) when 'overdue' then coalesce(compliance, 1000) else 0 end as k2
        from filtered
        order by k1, k2, full_name
        limit p_limit offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'::jsonb))
  into v;
  return v;
end $$;
grant execute on function public.dashboard_people(jsonb, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Cumplimiento agrupado (ranking): company, branch, department, position o course
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_breakdown(p_group text, f jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not app.can_any('progress.read') then perform app.fail('FORBIDDEN', 'progress.read'); end if;
  if p_group not in ('company', 'branch', 'department', 'position', 'course') then perform app.fail('VALIDATION', '{"group":"invalid"}'); end if;
  f := coalesce(f, '{}');

  with e as (
    select e.*, p.company_id, p.branch_id, p.department_id, p.position_id
    from app.dash_enrollments('progress.read', f) e join public.profiles p on p.id = e.user_id
  ), k as (
    select case p_group
             when 'company' then company_id when 'branch' then branch_id when 'department' then department_id
             when 'position' then position_id else course_id end as key, e.*
    from e
  ), agg as (
    select key,
      count(distinct user_id) as users,
      count(*) as assigned,
      count(*) filter (where bucket = 'completed') as completed,
      count(*) filter (where bucket = 'pending') as pending,
      count(*) filter (where bucket = 'overdue') as overdue,
      count(*) filter (where bucket = 'failed') as failed,
      round(avg(final_score) filter (where result in ('passed', 'failed')), 1) as avg_score,
      app.pct(count(*) filter (where result = 'failed'), count(*) filter (where result in ('passed', 'failed'))) as fail_rate,
      app.pct(count(*) filter (where bucket = 'completed'), count(*)) as compliance
    from k group by key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.key,
      'name', coalesce(case p_group
                when 'company' then (select c.name from public.companies c where c.id = a.key)
                when 'branch' then (select co.short_name || ' · ' || b.name from public.branches b join public.companies co on co.id = b.company_id where b.id = a.key)
                when 'department' then (select co.short_name || ' · ' || d.name from public.departments d join public.companies co on co.id = d.company_id where d.id = a.key)
                when 'position' then (select co.short_name || ' · ' || po.name from public.positions po join public.companies co on co.id = po.company_id where po.id = a.key)
                else (select cr.title from public.courses cr where cr.id = a.key) end, 'Sin asignar'),
      'code', case when p_group = 'course' then (select cr.code from public.courses cr where cr.id = a.key) end,
      'users', a.users, 'assigned', a.assigned, 'completed', a.completed, 'pending', a.pending,
      'overdue', a.overdue, 'failed', a.failed, 'avg_score', a.avg_score, 'fail_rate', a.fail_rate, 'compliance', a.compliance)
    order by a.compliance desc nulls last, a.users desc), '[]'::jsonb)
  into v from agg a;
  return v;
end $$;
grant execute on function public.dashboard_breakdown(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Actividad reciente (asignaciones, terminados, aprobados y reprobados) del alcance
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_activity(f jsonb default '{}', p_limit int default 10)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not app.can_any('progress.read') then perform app.fail('FORBIDDEN', 'progress.read'); end if;
  f := coalesce(f, '{}');
  with e as (
    select e.*, p.full_name from public.enrollments e
    join app.dash_people('progress.read', f) p on p.id = e.user_id
    where e.state <> 'cancelled'
      and greatest(e.assigned_at, e.passed_at, e.failed_at, e.content_completed_at) > now() - interval '90 days'
  ), ev as (
    select user_id, full_name, course_id, 'assigned' as kind, assigned_at as at from e
    union all select user_id, full_name, course_id, 'passed', passed_at from e where passed_at is not null
    union all select user_id, full_name, course_id, 'failed', failed_at from e where failed_at is not null
    union all select user_id, full_name, course_id, 'completed', content_completed_at from e
      where content_completed_at is not null and passed_at is null and progress_status = 'completed'
  )
  select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) into v from (
    select ev.user_id, ev.full_name, ev.kind, ev.at, c.title as course from ev join public.courses c on c.id = ev.course_id
    order by ev.at desc limit least(greatest(coalesce(p_limit, 10), 1), 50)
  ) x;
  return v;
end $$;
grant execute on function public.dashboard_activity(jsonb, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Foto diaria de cumplimiento (para la evolución mensual sin recalcular el pasado)
-- ---------------------------------------------------------------------------
create table public.compliance_snapshots (
  id               bigint generated always as identity primary key,
  snapshot_date    date not null,
  company_id       uuid not null references public.companies (id),
  branch_id        uuid references public.branches (id),
  department_id    uuid references public.departments (id),
  course_id        uuid references public.courses (id),
  assigned         int not null default 0,
  completed        int not null default 0,
  passed           int not null default 0,
  failed           int not null default 0,
  overdue          int not null default 0,
  in_progress      int not null default 0,
  avg_score        numeric(5,2),
  training_seconds bigint not null default 0,
  created_at       timestamptz not null default now()
);
create unique index compliance_snapshots_key on public.compliance_snapshots
  (snapshot_date, company_id, branch_id, department_id, course_id) nulls not distinct;
create index compliance_snapshots_date_idx on public.compliance_snapshots (snapshot_date);
alter table public.compliance_snapshots enable row level security;
revoke all on public.compliance_snapshots from anon, authenticated;   -- solo por RPC

create or replace function app.compliance_snapshot_job(p_date date default null)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_date date := coalesce(p_date, app.local_today('America/Mexico_City')); n int;
begin
  insert into public.compliance_snapshots as s
    (snapshot_date, company_id, branch_id, department_id, course_id, assigned, completed, passed, failed, overdue, in_progress, avg_score, training_seconds)
  select v_date, p.company_id, p.branch_id, p.department_id, e.course_id,
    count(*),
    count(*) filter (where e.progress_status = 'completed'),
    count(*) filter (where e.result = 'passed'),
    count(*) filter (where e.result = 'failed' and e.progress_status <> 'completed'),
    count(*) filter (where e.progress_status <> 'completed' and e.result <> 'failed' and e.due_at < now()),
    count(*) filter (where e.progress_status = 'in_progress'),
    round(avg(e.final_score) filter (where e.result in ('passed', 'failed')), 2),
    coalesce(sum(e.total_seconds), 0)
  from public.enrollments e join public.profiles p on p.id = e.user_id
  where e.state = 'active' and e.requirement = 'mandatory' and p.status = 'active'
  group by p.company_id, p.branch_id, p.department_id, e.course_id
  on conflict (snapshot_date, company_id, branch_id, department_id, course_id) do update set
    assigned = excluded.assigned, completed = excluded.completed, passed = excluded.passed, failed = excluded.failed,
    overdue = excluded.overdue, in_progress = excluded.in_progress, avg_score = excluded.avg_score,
    training_seconds = excluded.training_seconds, created_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.compliance_snapshot_job(date) from public;

-- Evolución mensual: la última foto de cada mes, dentro del alcance (empresa, sucursal o departamento).
-- Con alcance de equipo (jefes) no hay foto por persona: se devuelve vacío.
create or replace function public.dashboard_trend(f jsonb default '{}', p_months int default 12)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not app.can_any('progress.read') then perform app.fail('FORBIDDEN', 'progress.read'); end if;
  f := coalesce(f, '{}');
  with recursive g as (
    select scope_type, scope_id from app.my_grants() where permission_key = 'progress.read'
  ), dep as (
    select d.id from public.departments d join g on g.scope_type = 'department' and d.id = g.scope_id
    union
    select c.id from public.departments c join dep on c.parent_id = dep.id
  ), s as (
    select * from public.compliance_snapshots s
    where s.snapshot_date >= (date_trunc('month', now()) - make_interval(months => greatest(least(coalesce(p_months, 12), 36), 1) - 1))::date
      and (exists (select 1 from g where scope_type = 'group')
           or s.company_id in (select scope_id from g where scope_type = 'company')
           or s.branch_id in (select scope_id from g where scope_type = 'branch')
           or s.department_id in (select id from dep))
      and (nullif(f ->> 'company_id', '') is null or s.company_id = (f ->> 'company_id')::uuid)
      and (nullif(f ->> 'branch_id', '') is null or s.branch_id = (f ->> 'branch_id')::uuid)
      and (nullif(f ->> 'department_id', '') is null or s.department_id = any (app.department_descendants((f ->> 'department_id')::uuid)))
      and (nullif(f ->> 'course_id', '') is null or s.course_id = (f ->> 'course_id')::uuid)
  ), last_day as (
    select max(snapshot_date) as d from s group by date_trunc('month', snapshot_date)
  )
  select coalesce(jsonb_agg(x order by x.month), '[]'::jsonb) into v from (
    select to_char(s.snapshot_date, 'YYYY-MM') as month, max(s.snapshot_date) as date,
      sum(s.assigned) as assigned, sum(s.completed) as completed, sum(s.overdue) as overdue, sum(s.failed) as failed,
      app.pct(sum(s.completed), sum(s.assigned)) as compliance
    from s where s.snapshot_date in (select d from last_day)
    group by 1
  ) x;
  return v;
end $$;
grant execute on function public.dashboard_trend(jsonb, int) to authenticated;

-- Índices que usan los tableros.
create index if not exists profiles_scope_idx on public.profiles (company_id, branch_id, department_id) where status = 'active';
create index if not exists enrollments_dash_idx on public.enrollments (user_id) include (course_id, progress_status, result, due_at, final_score)
  where state = 'active' and requirement = 'mandatory';

-- Primera foto (la historia empieza hoy) y job diario a las 01:00 de Ciudad de México.
select app.compliance_snapshot_job();
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('compliance-snapshot', '0 7 * * *', 'select app.compliance_snapshot_job()');
  end if;
end $$;
