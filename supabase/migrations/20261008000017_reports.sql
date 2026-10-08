-- ============================================================================
-- 0017 · Reportes (Fase 7)
-- Los 10 reportes de la §24 salen de UNA función, public.report(clave, filtros, límite, desplazamiento),
-- que aplica el alcance de 'reports.read' una sola vez (app.dash_people). Las exportaciones quedan en la bitácora.
-- Filtros comunes (jsonb): company_id, branch_id, department_id, position_id, manager_id, q, course_id, from, to, status.
-- ============================================================================

-- Personas del reporte con los nombres de su organización.
create or replace function app.rep_people(p_perm text, f jsonb, p_any_status boolean default true)
returns table (id uuid, employee_number text, full_name text, email text, company text, branch text, department text,
               job_position text, manager text, status public.user_status, hire_date date, last_login_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.employee_number, p.full_name, coalesce(pr.email, pr.username), c.short_name, b.name, d.name, po.name, m.full_name,
         p.status, pr.hire_date, pr.last_login_at
  from app.dash_people(p_perm, f, p_any_status) p
  join public.profiles pr on pr.id = p.id
  join public.companies c on c.id = p.company_id
  left join public.branches b on b.id = p.branch_id
  left join public.departments d on d.id = p.department_id
  left join public.positions po on po.id = p.position_id
  left join public.profiles m on m.id = pr.manager_id
$$;

create or replace function app.in_range(p_at timestamptz, f jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select (nullif(f ->> 'from', '') is null or p_at >= (f ->> 'from')::date)
     and (nullif(f ->> 'to', '') is null or p_at < (f ->> 'to')::date + 1)
$$;

create or replace function public.report(p_key text, f jsonb default '{}', p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
  lo int := greatest(coalesce(p_offset, 0), 0);
  hi int := greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 100), 1), 5000);
  v_course uuid;
begin
  if not app.can_any('reports.read') then perform app.fail('FORBIDDEN', 'reports.read'); end if;
  f := coalesce(f, '{}');
  v_course := nullif(f ->> 'course_id', '')::uuid;

  case p_key
  -- 1. Usuarios ---------------------------------------------------------------
  when 'users' then
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by p.full_name) rn, jsonb_build_object(
        'numero', p.employee_number, 'nombre', p.full_name, 'correo', p.email, 'empresa', p.company, 'sucursal', p.branch,
        'departamento', p.department, 'puesto', p.job_position, 'jefe', p.manager, 'estado', p.status, 'ingreso', p.hire_date,
        'ultimo_acceso', p.last_login_at,
        'asignados', (select count(*) from public.enrollments e where e.user_id = p.id and e.state = 'active'),
        'completados', (select count(*) from public.enrollments e where e.user_id = p.id and e.state = 'active' and e.progress_status = 'completed')) r
      from app.rep_people('reports.read', f) p
      where nullif(f ->> 'status', '') is null or p.status::text = f ->> 'status'
    ) s;

  -- 2. Cursos -----------------------------------------------------------------
  when 'courses' then
    with people as (select id from app.dash_people('reports.read', f)),
    e as (
      select e.* from public.enrollments e join people p on p.id = e.user_id
      where e.state = 'active' and app.in_range(e.assigned_at, f)
    )
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by c.title) rn, jsonb_build_object(
        'clave', c.code, 'curso', c.title, 'estado', c.status,
        'version', (select version_number from public.course_versions where id = c.current_version_id),
        'tipo', c.default_requirement, 'vigencia_meses', c.validity_months, 'constancia', c.issues_certificate,
        'asignados', count(e.id),
        'en_progreso', count(e.id) filter (where e.progress_status = 'in_progress'),
        'completados', count(e.id) filter (where e.progress_status = 'completed'),
        'vencidos', count(e.id) filter (where e.progress_status <> 'completed' and e.result <> 'failed' and e.due_at < now()),
        'reprobados', count(e.id) filter (where e.result = 'failed' and e.progress_status <> 'completed'),
        'cumplimiento', app.pct(count(e.id) filter (where e.progress_status = 'completed'), count(e.id)),
        'promedio', round(avg(e.final_score) filter (where e.result in ('passed', 'failed')), 1),
        'horas', round(coalesce(sum(e.total_seconds), 0) / 3600.0, 2)) r
      from public.courses c left join e on e.course_id = c.id
      where c.deleted_at is null and (v_course is null or c.id = v_course)
        and (nullif(f ->> 'status', '') is null or c.status::text = f ->> 'status')
      group by c.id
      having count(e.id) > 0 or app.can_manage_course(c.id, 'courses.read')
    ) s;

  -- 3. Cumplimiento (por persona) ----------------------------------------------
  when 'compliance' then
    with agg as (
      select e.user_id, count(*) n,
        count(*) filter (where bucket = 'completed') completed, count(*) filter (where bucket = 'pending') pending,
        count(*) filter (where bucket = 'overdue') overdue, count(*) filter (where bucket = 'failed') failed,
        round(avg(final_score) filter (where result in ('passed', 'failed')), 1) avg_score
      from app.dash_enrollments('reports.read', f) e group by e.user_id
    )
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by app.pct(a.completed, a.n) nulls last, p.full_name) rn, jsonb_build_object(
        'numero', p.employee_number, 'nombre', p.full_name, 'empresa', p.company, 'sucursal', p.branch, 'departamento', p.department,
        'puesto', p.job_position, 'jefe', p.manager, 'asignados', coalesce(a.n, 0), 'completados', coalesce(a.completed, 0),
        'pendientes', coalesce(a.pending, 0), 'vencidos', coalesce(a.overdue, 0), 'reprobados', coalesce(a.failed, 0),
        'cumplimiento', app.pct(a.completed, a.n),
        'semaforo', case when a.n is null then null when app.pct(a.completed, a.n) >= 90 then 'Verde' when app.pct(a.completed, a.n) >= 70 then 'Amarillo' else 'Rojo' end,
        'promedio', a.avg_score) r
      from app.rep_people('reports.read', f, false) p left join agg a on a.user_id = p.id
      where a.user_id is not null or (v_course is null and nullif(f ->> 'from', '') is null and nullif(f ->> 'to', '') is null)
    ) s;

  -- 4. Calificaciones (resultado final por curso) -------------------------------
  when 'grades' then
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by coalesce(e.passed_at, e.failed_at) desc nulls last, p.full_name) rn, jsonb_build_object(
        'numero', p.employee_number, 'nombre', p.full_name, 'empresa', p.company, 'departamento', p.department,
        'curso', c.title, 'clave', c.code, 'version', cv.version_number, 'ciclo', e.cycle,
        'calificacion', e.final_score, 'resultado', e.result, 'fecha', coalesce(e.passed_at, e.failed_at),
        'intentos', (select count(*) from public.exam_attempts a where a.enrollment_id = e.id and a.status not in ('in_progress', 'voided'))) r
      from public.enrollments e
      join app.rep_people('reports.read', f) p on p.id = e.user_id
      join public.courses c on c.id = e.course_id
      left join public.course_versions cv on cv.id = e.course_version_id
      where e.state <> 'cancelled' and e.result in ('passed', 'failed', 'pending_review')
        and (v_course is null or e.course_id = v_course)
        and app.in_range(coalesce(e.passed_at, e.failed_at, e.updated_at), f)
        and (nullif(f ->> 'status', '') is null or e.result::text = f ->> 'status')
    ) s;

  -- 5. Exámenes (cada intento) -------------------------------------------------
  when 'exams' then
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by a.submitted_at desc nulls last, p.full_name) rn, jsonb_build_object(
        'numero', p.employee_number, 'nombre', p.full_name, 'empresa', p.company, 'departamento', p.department,
        'curso', c.title, 'examen', x.title, 'intento', a.attempt_number, 'inicio', a.started_at, 'entrega', a.submitted_at,
        'minutos', round(coalesce(a.duration_seconds, 0) / 60.0, 1), 'calificacion', a.score_pct,
        'resultado', case when a.status = 'voided' then 'voided' when a.status = 'pending_review' then 'pending_review'
                          when a.passed then 'passed' when a.passed is false then 'failed' else a.status::text end,
        'entregado_por', a.submitted_by, 'motivo_anulacion', a.void_reason) r
      from public.exam_attempts a
      join app.rep_people('reports.read', f) p on p.id = a.user_id
      join public.exams x on x.id = a.exam_id
      join public.enrollments e on e.id = a.enrollment_id
      join public.courses c on c.id = e.course_id
      where a.status <> 'in_progress' and (v_course is null or e.course_id = v_course)
        and app.in_range(a.submitted_at, f)
    ) s;

  -- 6. Cursos vencidos ----------------------------------------------------------
  when 'overdue' then
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by e.due_at, p.full_name) rn, jsonb_build_object(
        'numero', p.employee_number, 'nombre', p.full_name, 'empresa', p.company, 'departamento', p.department, 'jefe', p.manager,
        'curso', c.title, 'tipo', e.requirement, 'asignado', e.assigned_at, 'fecha_limite', e.due_at,
        'dias_atraso', (now()::date - (e.due_at at time zone 'America/Mexico_City')::date), 'avance', e.progress_pct) r
      from public.enrollments e
      join app.rep_people('reports.read', f, false) p on p.id = e.user_id
      join public.courses c on c.id = e.course_id
      where e.state = 'active' and e.progress_status <> 'completed' and e.result <> 'failed' and e.due_at < now()
        and (v_course is null or e.course_id = v_course) and app.in_range(e.due_at, f)
    ) s;

  -- 7. Personas reprobadas -------------------------------------------------------
  when 'failed' then
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by e.failed_at desc nulls last, p.full_name) rn, jsonb_build_object(
        'numero', p.employee_number, 'nombre', p.full_name, 'empresa', p.company, 'departamento', p.department, 'jefe', p.manager,
        'curso', c.title, 'calificacion', e.final_score,
        'intentos', (select count(*) from public.exam_attempts a where a.enrollment_id = e.id and a.status not in ('in_progress', 'voided')),
        'fecha', e.failed_at) r
      from public.enrollments e
      join app.rep_people('reports.read', f) p on p.id = e.user_id
      join public.courses c on c.id = e.course_id
      where e.state = 'active' and e.result = 'failed' and e.progress_status <> 'completed'
        and (v_course is null or e.course_id = v_course) and app.in_range(e.failed_at, f)
    ) s;

  -- 8. Horas de capacitación (por persona) ----------------------------------------
  when 'hours' then
    with h as (
      select e.user_id, count(*) filter (where e.total_seconds > 0) courses, sum(e.total_seconds) secs,
             sum(e.total_seconds) filter (where e.progress_status = 'completed') secs_done
      from public.enrollments e
      where e.state <> 'cancelled' and (v_course is null or e.course_id = v_course) and app.in_range(e.assigned_at, f)
      group by e.user_id
    )
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by coalesce(h.secs, 0) desc, p.full_name) rn, jsonb_build_object(
        'numero', p.employee_number, 'nombre', p.full_name, 'empresa', p.company, 'sucursal', p.branch, 'departamento', p.department,
        'puesto', p.job_position, 'cursos', coalesce(h.courses, 0), 'horas', round(coalesce(h.secs, 0) / 3600.0, 2),
        'horas_terminados', round(coalesce(h.secs_done, 0) / 3600.0, 2)) r
      from app.rep_people('reports.read', f, false) p left join h on h.user_id = p.id
    ) s;

  -- 9. Certificados ---------------------------------------------------------------
  when 'certificates' then
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by k.issued_at desc) rn, jsonb_build_object(
        'folio', k.number, 'numero', p.employee_number, 'nombre', k.holder_name, 'empresa', p.company, 'departamento', p.department,
        'curso', k.course_title, 'clave', k.course_code, 'emision', k.issued_at, 'vigencia', k.expires_at, 'calificacion', k.score,
        'estado', case when k.status = 'revoked' then 'revoked' when k.expires_at < now() then 'expired' else 'valid' end,
        'motivo_revocacion', k.revoked_reason) r
      from public.certificates k
      join app.rep_people('reports.read', f) p on p.id = k.user_id
      where (v_course is null or k.course_id = v_course) and app.in_range(k.issued_at, f)
        and (nullif(f ->> 'status', '') is null
             or f ->> 'status' = case when k.status = 'revoked' then 'revoked' when k.expires_at < now() then 'expired' else 'valid' end)
    ) s;

  -- 10. Actividad (últimos 30 días si no se indica periodo) -------------------------
  when 'activity' then
    if nullif(f ->> 'from', '') is null and nullif(f ->> 'to', '') is null then
      f := f || jsonb_build_object('from', (now() - interval '30 days')::date);
    end if;
    with p as (select * from app.rep_people('reports.read', f)),
    ev as (
      select e.user_id, e.course_id, 'assigned' kind, e.assigned_at at, null::text detail from public.enrollments e where e.user_id in (select id from p)
      union all select e.user_id, e.course_id, 'started', e.started_at, null from public.enrollments e where e.started_at is not null and e.user_id in (select id from p)
      union all select e.user_id, e.course_id, 'completed', e.content_completed_at, null from public.enrollments e where e.content_completed_at is not null and e.user_id in (select id from p)
      union all select e.user_id, e.course_id, 'passed', e.passed_at, e.final_score::text || '%' from public.enrollments e where e.passed_at is not null and e.user_id in (select id from p)
      union all select e.user_id, e.course_id, 'failed', e.failed_at, e.final_score::text || '%' from public.enrollments e where e.failed_at is not null and e.user_id in (select id from p)
      union all select e.user_id, e.course_id, 'cancelled', e.cancelled_at, e.cancel_reason from public.enrollments e where e.cancelled_at is not null and e.user_id in (select id from p)
      union all select a.user_id, e.course_id, 'exam_submitted', a.submitted_at, x.title || ' · intento ' || a.attempt_number || coalesce(' · ' || a.score_pct || '%', '')
        from public.exam_attempts a join public.enrollments e on e.id = a.enrollment_id join public.exams x on x.id = a.exam_id
        where a.submitted_at is not null and a.user_id in (select id from p)
      union all select k.user_id, k.course_id, 'certificate_issued', k.issued_at, k.number from public.certificates k where k.user_id in (select id from p)
      union all select k.user_id, k.course_id, 'certificate_revoked', k.revoked_at, k.revoked_reason from public.certificates k where k.revoked_at is not null and k.user_id in (select id from p)
    )
    select jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r order by rn) filter (where rn > lo and rn <= hi), '[]'))
    into v from (
      select row_number() over (order by ev.at desc, p.full_name) rn, jsonb_build_object(
        'fecha', ev.at, 'numero', p.employee_number, 'nombre', p.full_name, 'empresa', p.company, 'departamento', p.department,
        'evento', ev.kind, 'curso', c.title, 'detalle', ev.detail) r
      from ev join p on p.id = ev.user_id join public.courses c on c.id = ev.course_id
      where app.in_range(ev.at, f) and (v_course is null or ev.course_id = v_course)
    ) s;

  else perform app.fail('VALIDATION', '{"report":"invalid"}');
  end case;
  return v;
end $$;
grant execute on function public.report(text, jsonb, int, int) to authenticated;

-- Cada exportación queda en la bitácora: quién, qué reporte, con qué filtros, en qué formato y cuántas filas.
create or replace function public.log_report_export(p_key text, p_format text, p_filters jsonb, p_rows int)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app.can_any('reports.export') then perform app.fail('FORBIDDEN', 'reports.export'); end if;
  if p_format not in ('xlsx', 'csv', 'pdf') then perform app.fail('VALIDATION', '{"format":"invalid"}'); end if;
  perform app.log('report.exported', 'report', null, app.my_company_id(), null,
    jsonb_build_object('report', p_key, 'format', p_format, 'filters', coalesce(p_filters, '{}'), 'rows', p_rows));
end $$;
grant execute on function public.log_report_export(text, text, jsonb, int) to authenticated;

-- Expediente de capacitación de una persona (PDF): todo su historial.
create or replace function public.training_record(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not (app.can_user('reports.read', p_user) or app.can_user('progress.read', p_user) or p_user = (select auth.uid())) then
    perform app.fail('FORBIDDEN', 'reports.read');
  end if;
  select jsonb_build_object(
    'person', (select to_jsonb(x) from (
        select p.full_name, p.employee_number, c.name company, b.name branch, d.name department, po.name as job_position, m.full_name manager, p.hire_date, p.status
        from public.profiles p join public.companies c on c.id = p.company_id left join public.branches b on b.id = p.branch_id
        left join public.departments d on d.id = p.department_id left join public.positions po on po.id = p.position_id
        left join public.profiles m on m.id = p.manager_id where p.id = p_user) x),
    'courses', coalesce((select jsonb_agg(to_jsonb(x) order by x.assigned_at desc) from (
        select c.title course, c.code, e.cycle, e.state, e.requirement, e.progress_status, e.result, e.progress_pct, e.final_score,
               e.assigned_at, e.due_at, e.passed_at, e.failed_at, e.content_completed_at, e.valid_until, round(e.total_seconds / 3600.0, 2) hours,
               (select number from public.certificates k where k.enrollment_id = e.id) certificate,
               (select count(*) from public.exam_attempts a where a.enrollment_id = e.id and a.status not in ('in_progress', 'voided')) attempts
        from public.enrollments e join public.courses c on c.id = e.course_id where e.user_id = p_user) x), '[]'),
    'certificates', coalesce((select jsonb_agg(to_jsonb(x) order by x.issued_at desc) from (
        select number, course_title, issued_at, expires_at, score,
               case when status = 'revoked' then 'revoked' when expires_at < now() then 'expired' else 'valid' end status
        from public.certificates where user_id = p_user) x), '[]'))
  into v;
  return v;
end $$;
grant execute on function public.training_record(uuid) to authenticated;
