-- =====================================================================
-- 0013 · Asignaciones por regla, usuarios futuros, fechas relativas, excepciones,
--        recapacitación, renovación por vigencia y avisos en la aplicación
-- =====================================================================

-- ---------------------------------------------------------------------
-- Avisos (in-app). El correo llega en la Fase 8 sobre esta misma tabla.
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete restrict,
  type        text not null check (type in ('course_assigned', 'due_soon', 'overdue', 'course_passed', 'course_failed', 'course_completed',
                                            'attempt_graded', 'retraining', 'renewal', 'extension', 'extra_attempts', 'cancelled')),
  title       text not null,
  body        text,
  link        text check (link is null or link ~ '^/'),
  entity_type text,
  entity_id   uuid,
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint notifications_dedupe_key unique (dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function app.notify(p_user uuid, p_type text, p_title text, p_body text, p_link text,
                                      p_entity_type text default null, p_entity_id uuid default null, p_dedupe text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, dedupe_key)
  values (p_user, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids))
$$;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Fechas: "15 de octubre" = fin de ese día en la zona horaria de la persona (C5)
-- ---------------------------------------------------------------------
create or replace function app.user_tz(p_user uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce(b.timezone, c.timezone, 'America/Mexico_City')
  from public.profiles p join public.companies c on c.id = p.company_id left join public.branches b on b.id = p.branch_id
  where p.id = p_user
$$;

create or replace function app.end_of_day(p_date date, p_tz text)
returns timestamptz language sql immutable set search_path = ''
as $$ select ((p_date + 1)::timestamp at time zone coalesce(p_tz, 'America/Mexico_City')) - interval '1 second' $$;

create or replace function app.local_today(p_tz text)
returns date language sql stable set search_path = ''
as $$ select (now() at time zone coalesce(p_tz, 'America/Mexico_City'))::date $$;

-- ---------------------------------------------------------------------
-- Excepciones auditables (prórrogas, intentos extra, acceso tardío, reasignación)
-- ---------------------------------------------------------------------
create table public.enrollment_exceptions (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  type          text not null check (type in ('due_extension', 'expiry_extension', 'extra_attempts', 'late_access', 'reassign', 'cancel')),
  exam_id       uuid references public.exams (id),
  value         jsonb not null default '{}'::jsonb,
  reason        text not null check (char_length(trim(reason)) between 3 and 500),
  granted_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index enrollment_exceptions_enrollment_idx on public.enrollment_exceptions (enrollment_id);
create trigger enrollment_exceptions_audit after insert on public.enrollment_exceptions for each row execute function audit.capture('enrollment_exception');
create trigger enrollment_exceptions_no_delete before delete on public.enrollment_exceptions for each row execute function app.guard_no_delete();
alter table public.enrollment_exceptions enable row level security;
revoke all on public.enrollment_exceptions from anon, authenticated;
grant select on public.enrollment_exceptions to authenticated;
create policy enrollment_exceptions_select on public.enrollment_exceptions for select to authenticated
  using (exists (select 1 from public.enrollments e where e.id = enrollment_id));

create or replace function app.extra_attempts(p_enrollment uuid, p_exam uuid)
returns int language sql stable security definer set search_path = ''
as $$
  select coalesce(sum((value ->> 'attempts')::int), 0)::int from public.enrollment_exceptions
  where enrollment_id = p_enrollment and type = 'extra_attempts' and (exam_id is null or exam_id = p_exam)
$$;

-- La posición en un examen ahora considera los intentos extra otorgados.
create or replace function app.exam_standing(p_enrollment uuid, p_exam uuid)
returns table (score numeric, passed boolean, used int, pending boolean, can_retry boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  ex public.exams;
  v_score numeric;
begin
  select * into ex from public.exams where id = p_exam;
  select case ex.scoring_policy
           when 'best' then max(score_pct)
           when 'average' then round(avg(score_pct), 2)
           else (array_agg(score_pct order by attempt_number desc))[1] end
    into v_score
  from public.exam_attempts where enrollment_id = p_enrollment and exam_id = p_exam and status = 'graded';
  score := v_score;
  passed := v_score is not null and v_score >= ex.passing_score;
  select count(*) filter (where status <> 'voided'), coalesce(bool_or(status in ('submitted', 'pending_review', 'in_progress')), false)
    into used, pending
  from public.exam_attempts where enrollment_id = p_enrollment and exam_id = p_exam;
  can_retry := ex.max_attempts is null or used < ex.max_attempts + app.extra_attempts(p_enrollment, p_exam);
  return next;
end $$;

-- ---------------------------------------------------------------------
-- Inscripciones a partir de una asignación
-- ---------------------------------------------------------------------
create or replace function app.user_matches(p_user uuid, a public.assignments)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.status = 'active'
      and (a.company_id is null or p.company_id = a.company_id)
      and (a.branch_id is null or p.branch_id = a.branch_id)
      and (a.department_id is null or p.department_id = any (
            select d.id from public.departments d where d.id = a.department_id or d.parent_id = a.department_id))
      and (a.position_id is null or p.position_id = a.position_id)
      and (a.user_group_id is null or exists (select 1 from public.user_group_members m where m.group_id = a.user_group_id and m.user_id = p.id))
  )
$$;

-- Crea la inscripción (si no tiene una activa del curso). Calcula fechas relativas en la zona de la persona.
create or replace function app.create_enrollment(p_user uuid, p_assignment uuid, p_due_override timestamptz default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  a public.assignments;
  c public.courses;
  v_tz text := app.user_tz(p_user);
  v_id uuid;
  v_due timestamptz;
  v_exp timestamptz;
begin
  select * into a from public.assignments where id = p_assignment;
  select * into c from public.courses where id = a.course_id;
  if c.status = 'archived' or c.deleted_at is not null then return null; end if;
  if exists (select 1 from public.enrollments where user_id = p_user and course_id = a.course_id and state = 'active') then return null; end if;
  v_due := coalesce(p_due_override, a.due_at, case when a.due_in_days is not null then app.end_of_day(app.local_today(v_tz) + a.due_in_days, v_tz) end);
  v_exp := coalesce(a.expires_at, case when a.expires_in_days is not null then app.end_of_day(app.local_today(v_tz) + a.expires_in_days, v_tz) end);
  insert into public.enrollments (user_id, course_id, assignment_id, cycle, requirement, available_from, due_at, expires_at, allow_late_access)
  values (p_user, a.course_id, a.id,
          coalesce((select max(cycle) + 1 from public.enrollments where user_id = p_user and course_id = a.course_id), 1),
          a.requirement, a.start_at, v_due, v_exp, a.allow_late_access)
  returning id into v_id;
  return v_id;
end $$;

-- Aviso al asignar.
create or replace function app.on_enrollment_created()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_title text;
begin
  select title into v_title from public.courses where id = new.course_id;
  perform app.notify(new.user_id, case when new.cycle > 1 then 'retraining' else 'course_assigned' end,
    case when new.cycle > 1 then format('Debes volver a tomar «%s»', v_title) else format('Se te asignó el curso «%s»', v_title) end,
    case when new.due_at is not null then format('Fecha límite: %s.', to_char(new.due_at at time zone app.user_tz(new.user_id), 'DD/MM/YYYY')) else null end,
    '/cursos/' || new.id, 'enrollment', new.id, 'assigned:' || new.id);
  return null;
end $$;
create trigger enrollments_notify_created after insert on public.enrollments for each row execute function app.on_enrollment_created();

-- Avisos de resultado.
create or replace function app.on_enrollment_result()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_title text;
begin
  select title into v_title from public.courses where id = new.course_id;
  if new.result = 'passed' and old.result is distinct from 'passed' then
    perform app.notify(new.user_id, 'course_passed', format('¡Aprobaste «%s»!', v_title),
      case when new.final_score is not null then format('Calificación final: %s%%.', new.final_score) end, '/cursos/' || new.id, 'enrollment', new.id, 'passed:' || new.id);
  elsif new.result = 'failed' and old.result is distinct from 'failed' then
    perform app.notify(new.user_id, 'course_failed', format('No aprobaste «%s»', v_title),
      'Ya usaste tus intentos. Tu administrador puede darte otra oportunidad.', '/cursos/' || new.id, 'enrollment', new.id, 'failed:' || new.id || ':' || coalesce(new.failed_at::text, ''));
  elsif new.progress_status = 'completed' and old.progress_status <> 'completed' and new.result = 'none' then
    perform app.notify(new.user_id, 'course_completed', format('Terminaste «%s»', v_title), null, '/cursos/' || new.id, 'enrollment', new.id, 'completed:' || new.id);
  end if;
  return null;
end $$;
create trigger enrollments_notify_result after update of result, progress_status on public.enrollments for each row execute function app.on_enrollment_result();

-- Aviso cuando se termina de calificar un intento que estaba en revisión.
create or replace function app.on_attempt_graded()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_enr uuid; v_title text;
begin
  if old.status = 'pending_review' and new.status = 'graded' then
    select e.id, x.title into v_enr, v_title from public.enrollments e join public.exams x on x.id = new.exam_id where e.id = new.enrollment_id;
    perform app.notify(new.user_id, 'attempt_graded', format('Ya se calificó tu examen «%s»', v_title), null,
      '/cursos/' || v_enr || '/examen/' || new.exam_id || '/resultado/' || new.id, 'exam_attempt', new.id, 'graded:' || new.id);
  end if;
  return null;
end $$;
create trigger exam_attempts_notify_graded after update of status on public.exam_attempts for each row execute function app.on_attempt_graded();

-- ---------------------------------------------------------------------
-- Crear asignaciones: personas concretas o por regla (empresa/sucursal/depto/puesto/grupo)
-- ---------------------------------------------------------------------
create or replace function app.assignment_scope_ok(p jsonb)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := nullif(p ->> 'company_id', '')::uuid;
  v_branch uuid := nullif(p ->> 'branch_id', '')::uuid;
  v_dept uuid := nullif(p ->> 'department_id', '')::uuid;
  v_pos uuid := nullif(p ->> 'position_id', '')::uuid;
  v_group uuid := nullif(p ->> 'user_group_id', '')::uuid;
begin
  -- La empresa se deduce de lo más específico para validar el alcance.
  v_company := coalesce(v_company, (select company_id from public.branches where id = v_branch),
                        (select company_id from public.departments where id = v_dept), (select company_id from public.positions where id = v_pos),
                        (select company_id from public.user_groups where id = v_group));
  if v_company is null then return app.can_group('assignments.write'); end if;
  return app.can('assignments.write', v_company, v_branch, v_dept);
end $$;

create or replace function public.create_assignment(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_course public.courses;
  v_mode public.assignment_mode := coalesce(nullif(p ->> 'mode', ''), 'direct')::public.assignment_mode;
  v_tz text := 'America/Mexico_City';
  a public.assignments;
  u uuid;
  v_created int := 0; v_skipped int := 0; v_forbidden int := 0;
begin
  select * into v_course from public.courses where id = (p ->> 'course_id')::uuid and deleted_at is null;
  if not found then perform app.fail('NOT_FOUND', 'course'); end if;
  if v_course.status = 'archived' then perform app.fail('COURSE_ARCHIVED'); end if;
  if not app.can_any('assignments.write') then perform app.fail('FORBIDDEN', 'assignments.write'); end if;
  if v_mode = 'rule' and num_nonnulls(nullif(p ->> 'company_id', ''), nullif(p ->> 'branch_id', ''), nullif(p ->> 'department_id', ''),
                                      nullif(p ->> 'position_id', ''), nullif(p ->> 'user_group_id', '')) = 0 then
    perform app.fail('VALIDATION', '{"criteria":"required"}');
  end if;
  if v_mode = 'rule' and not app.assignment_scope_ok(p) then perform app.fail('FORBIDDEN', 'assignments.write'); end if;
  if v_mode = 'direct' and coalesce(jsonb_array_length(p -> 'user_ids'), 0) = 0 then perform app.fail('VALIDATION', '{"users":"required"}'); end if;
  if nullif(p ->> 'due_date', '') is not null and nullif(p ->> 'due_in_days', '') is not null then perform app.fail('VALIDATION', '{"due":"one"}'); end if;
  v_tz := coalesce((select timezone from public.companies where id = coalesce(nullif(p ->> 'company_id', '')::uuid, v_course.owner_company_id)), v_tz);

  insert into public.assignments (course_id, mode, company_id, branch_id, department_id, position_id, user_group_id, include_future_users,
                                  requirement, start_at, due_at, due_in_days, expires_at, expires_in_days, allow_late_access, notes, created_by)
  values (v_course.id, v_mode,
          case when v_mode = 'rule' then nullif(p ->> 'company_id', '')::uuid end, case when v_mode = 'rule' then nullif(p ->> 'branch_id', '')::uuid end,
          case when v_mode = 'rule' then nullif(p ->> 'department_id', '')::uuid end, case when v_mode = 'rule' then nullif(p ->> 'position_id', '')::uuid end,
          case when v_mode = 'rule' then nullif(p ->> 'user_group_id', '')::uuid end,
          v_mode = 'rule' and coalesce((p ->> 'include_future_users')::boolean, false),
          coalesce(nullif(p ->> 'requirement', ''), v_course.default_requirement::text)::public.requirement_level,
          nullif(p ->> 'start_at', '')::timestamptz,
          case when nullif(p ->> 'due_date', '') is not null then app.end_of_day((p ->> 'due_date')::date, v_tz) end,
          nullif(p ->> 'due_in_days', '')::int,
          case when nullif(p ->> 'expires_date', '') is not null then app.end_of_day((p ->> 'expires_date')::date, v_tz) end,
          nullif(p ->> 'expires_in_days', '')::int,
          coalesce((p ->> 'allow_late_access')::boolean, true), nullif(trim(p ->> 'notes'), ''), app.actor_id())
  returning * into a;

  if v_mode = 'direct' then
    for u in select (x)::uuid from jsonb_array_elements_text(p -> 'user_ids') x loop
      if not app.can_user('assignments.write', u) or not exists (select 1 from public.profiles where id = u and status = 'active') then
        v_forbidden := v_forbidden + 1;
      elsif app.create_enrollment(u, a.id) is null then v_skipped := v_skipped + 1;
      else v_created := v_created + 1;
      end if;
    end loop;
  else
    for u in select p2.id from public.profiles p2 where p2.status = 'active' and app.user_matches(p2.id, a) loop
      if not app.can_user('assignments.write', u) then v_forbidden := v_forbidden + 1;
      elsif app.create_enrollment(u, a.id) is null then v_skipped := v_skipped + 1;
      else v_created := v_created + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('assignment_id', a.id, 'created', v_created, 'skipped', v_skipped, 'forbidden', v_forbidden);
end $$;
grant execute on function public.create_assignment(jsonb) to authenticated;

-- Vista previa: a cuántas personas activas (dentro del alcance) llegaría una regla.
create or replace function public.preview_assignment(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  a public.assignments;
  v_match int; v_already int;
begin
  if not app.can_any('assignments.write') then perform app.fail('FORBIDDEN'); end if;
  a.company_id := nullif(p ->> 'company_id', '')::uuid; a.branch_id := nullif(p ->> 'branch_id', '')::uuid;
  a.department_id := nullif(p ->> 'department_id', '')::uuid; a.position_id := nullif(p ->> 'position_id', '')::uuid;
  a.user_group_id := nullif(p ->> 'user_group_id', '')::uuid;
  select count(*), count(*) filter (where exists (select 1 from public.enrollments e where e.user_id = p2.id and e.course_id = (p ->> 'course_id')::uuid and e.state = 'active'))
    into v_match, v_already
  from public.profiles p2 where p2.status = 'active' and app.user_matches(p2.id, a) and app.can_user('assignments.write', p2.id);
  return jsonb_build_object('matching', v_match, 'already', v_already, 'new', v_match - v_already);
end $$;
grant execute on function public.preview_assignment(jsonb) to authenticated;

-- La asignación directa de la Fase 2 ahora usa el mismo camino.
create or replace function public.admin_enroll(p_course uuid, p_user_ids uuid[], p_due_at timestamptz default null,
                                               p_requirement public.requirement_level default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r jsonb;
begin
  r := public.create_assignment(jsonb_build_object('course_id', p_course, 'mode', 'direct', 'user_ids', to_jsonb(p_user_ids),
         'requirement', p_requirement, 'notes', p_notes));
  if p_due_at is not null then
    update public.enrollments set due_at = p_due_at where assignment_id = (r ->> 'assignment_id')::uuid;
    update public.assignments set due_at = p_due_at where id = (r ->> 'assignment_id')::uuid;
  end if;
  return r;
end $$;

create or replace function public.set_assignment_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.assignments;
begin
  select * into a from public.assignments where id = p_id for update;
  if not found then perform app.fail('NOT_FOUND', 'assignment'); end if;
  if not app.can_manage_course(a.course_id, 'courses.read') or not app.can_any('assignments.write') then perform app.fail('FORBIDDEN'); end if;
  update public.assignments set is_active = p_active where id = p_id;
end $$;
grant execute on function public.set_assignment_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Altas, cambios de puesto y bajas (D6): se aplica automáticamente al guardar el perfil
-- ---------------------------------------------------------------------
create or replace function app.apply_rules_for_user(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
  a public.assignments;
  e record;
begin
  select * into p from public.profiles where id = p_user;
  if p.status <> 'active' then
    -- Baja o inactivo: se cancelan los cursos no iniciados; lo iniciado o terminado se conserva.
    update public.enrollments set state = 'cancelled', cancelled_at = now(), cancelled_by = app.actor_id(),
           cancel_reason = 'Usuario ' || case p.status when 'deleted' then 'dado de baja' when 'suspended' then 'suspendido' else 'inactivo' end
    where user_id = p_user and state = 'active' and progress_status = 'not_started';
    return;
  end if;
  -- Ya no le corresponde (cambió de puesto/área): se cancelan las no iniciadas que venían de una regla.
  for e in select en.id as enrollment_id, en.assignment_id from public.enrollments en join public.assignments asg on asg.id = en.assignment_id
           where en.user_id = p_user and en.state = 'active' and en.progress_status = 'not_started' and asg.mode = 'rule' loop
    select * into a from public.assignments where id = e.assignment_id;
    if not app.user_matches(p_user, a) then
      update public.enrollments set state = 'cancelled', cancelled_at = now(), cancelled_by = app.actor_id(), cancel_reason = 'Cambio de puesto o área'
      where id = e.enrollment_id;
    end if;
  end loop;
  -- Le corresponde por una regla con "usuarios futuros": se inscribe.
  for a in select * from public.assignments where is_active and mode = 'rule' and include_future_users loop
    if app.user_matches(p_user, a) then perform app.create_enrollment(p_user, a.id); end if;
  end loop;
end $$;

create or replace function app.on_profile_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.company_id, new.branch_id, new.department_id, new.position_id, new.status)
     is distinct from (old.company_id, old.branch_id, old.department_id, old.position_id, old.status) then
    perform app.apply_rules_for_user(new.id);
  end if;
  return null;
end $$;
create trigger profiles_apply_rules after insert or update of company_id, branch_id, department_id, position_id, status
  on public.profiles for each row execute function app.on_profile_changed();

create or replace function app.on_group_member_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform app.apply_rules_for_user(coalesce(new.user_id, old.user_id)); return null; end $$;
create trigger user_group_members_apply_rules after insert or delete on public.user_group_members
  for each row execute function app.on_group_member_changed();

-- ---------------------------------------------------------------------
-- Excepciones (enrollments.adjust)
-- ---------------------------------------------------------------------
create or replace function public.grant_exception(p_enrollment uuid, p_type text, p jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  e public.enrollments;
  v_tz text;
  v_title text;
  v_new uuid;
  v_exam uuid := nullif(p ->> 'exam_id', '')::uuid;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if not found then perform app.fail('NOT_FOUND', 'enrollment'); end if;
  if not app.can_user('enrollments.adjust', e.user_id) then perform app.fail('FORBIDDEN', 'enrollments.adjust'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', '{"reason":"required"}'); end if;
  v_tz := app.user_tz(e.user_id);
  select title into v_title from public.courses where id = e.course_id;

  case p_type
    when 'due_extension' then
      if e.state <> 'active' then perform app.fail('ENROLLMENT_NOT_ACTIVE'); end if;
      update public.enrollments set due_at = app.end_of_day((p ->> 'date')::date, v_tz) where id = e.id;
      perform app.notify(e.user_id, 'extension', format('Nueva fecha límite para «%s»', v_title), format('Ahora vence el %s.', to_char((p ->> 'date')::date, 'DD/MM/YYYY')),
                         '/cursos/' || e.id, 'enrollment', e.id, null);
    when 'expiry_extension' then
      update public.enrollments set expires_at = case when nullif(p ->> 'date', '') is null then null else app.end_of_day((p ->> 'date')::date, v_tz) end where id = e.id;
    when 'late_access' then
      update public.enrollments set allow_late_access = true where id = e.id;
    when 'extra_attempts' then
      if coalesce((p ->> 'attempts')::int, 0) not between 1 and 10 then perform app.fail('VALIDATION', '{"attempts":"invalid"}'); end if;
      if v_exam is null or not exists (select 1 from public.exams where id = v_exam and course_version_id = e.course_version_id) then
        perform app.fail('VALIDATION', '{"exam_id":"invalid"}');
      end if;
    when 'reassign' then
      -- Nuevo ciclo: el anterior queda en el historial como reemplazado.
      if e.state = 'active' then update public.enrollments set state = 'superseded' where id = e.id; end if;
      insert into public.enrollments (user_id, course_id, assignment_id, cycle, requirement, due_at, allow_late_access)
      values (e.user_id, e.course_id, e.assignment_id, (select max(cycle) + 1 from public.enrollments where user_id = e.user_id and course_id = e.course_id),
              e.requirement, case when nullif(p ->> 'date', '') is not null then app.end_of_day((p ->> 'date')::date, v_tz) end, true)
      returning id into v_new;
    else perform app.fail('VALIDATION', '{"type":"invalid"}');
  end case;

  insert into public.enrollment_exceptions (enrollment_id, type, exam_id, value, reason, granted_by)
  values (e.id, p_type, v_exam, coalesce(p, '{}'::jsonb) || jsonb_build_object('previous_due_at', e.due_at, 'new_enrollment', v_new), trim(p_reason), app.actor_id());
  if p_type = 'extra_attempts' then
    perform app.recompute_enrollment(e.id);
    perform app.notify(e.user_id, 'extra_attempts', format('Tienes otra oportunidad en «%s»', v_title),
      format('Se te otorgó%s %s intento%s más.', '', p ->> 'attempts', case when (p ->> 'attempts')::int = 1 then '' else 's' end),
      '/cursos/' || e.id, 'enrollment', e.id, null);
  end if;
  return coalesce(v_new, e.id);
end $$;
grant execute on function public.grant_exception(uuid, text, jsonb, text) to authenticated;

create or replace function public.cancel_enrollment(p_enrollment uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare e public.enrollments;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if not found then perform app.fail('NOT_FOUND', 'enrollment'); end if;
  if not app.can_user('enrollments.adjust', e.user_id) then perform app.fail('FORBIDDEN', 'enrollments.adjust'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', '{"reason":"required"}'); end if;
  if e.state <> 'active' then return; end if;
  update public.enrollments set state = 'cancelled', cancelled_at = now(), cancelled_by = app.actor_id(), cancel_reason = trim(p_reason) where id = e.id;
  insert into public.enrollment_exceptions (enrollment_id, type, reason, granted_by) values (e.id, 'cancel', trim(p_reason), app.actor_id());
end $$;

-- ---------------------------------------------------------------------
-- Recapacitación al publicar (D7) y vigencia / renovación (§19)
-- ---------------------------------------------------------------------
create or replace function app.supersede_and_renew(p_enrollment uuid, p_due timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare e public.enrollments; v_new uuid;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if e.state <> 'active' then return null; end if;
  update public.enrollments set state = 'superseded' where id = e.id;
  insert into public.enrollments (user_id, course_id, assignment_id, cycle, requirement, due_at, allow_late_access)
  values (e.user_id, e.course_id, e.assignment_id, e.cycle + 1, e.requirement, p_due, true)
  returning id into v_new;
  return v_new;
end $$;

alter function public.publish_course_version(uuid, text, boolean) rename to publish_course_version_v2;
create or replace function public.publish_course_version(p_course uuid, p_change_summary text default null, p_requires_retraining boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v uuid;
  r record;
begin
  v := public.publish_course_version_v2(p_course, p_change_summary, p_requires_retraining);
  if p_requires_retraining then
    for r in select id, user_id from public.enrollments
             where course_id = p_course and state = 'active' and course_version_id is not null and course_version_id <> v
               and (result = 'passed' or (result = 'none' and progress_status = 'completed')) loop
      perform app.supersede_and_renew(r.id, app.end_of_day(app.local_today(app.user_tz(r.user_id)) + 30, app.user_tz(r.user_id)));
    end loop;
  end if;
  return v;
end $$;
revoke execute on function public.publish_course_version_v2(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.publish_course_version(uuid, text, boolean) to authenticated;

-- Vigencia: al aprobar (o completar si no hay examen) se calcula hasta cuándo vale.
create or replace function app.set_valid_until()
returns trigger language plpgsql set search_path = ''
as $$
declare v_months int;
begin
  if (new.result = 'passed' and old.result is distinct from 'passed') or (new.result = 'none' and new.progress_status = 'completed' and old.progress_status <> 'completed') then
    select validity_months into v_months from public.courses where id = new.course_id;
    new.valid_until := case when v_months is not null then coalesce(new.passed_at, now()) + make_interval(months => v_months) end;
  end if;
  return new;
end $$;
create trigger enrollments_valid_until before update of result, progress_status on public.enrollments for each row execute function app.set_valid_until();

-- Diario: renovación 30 días antes de que venza la vigencia, y recordatorios de fecha límite (7/3/1 días y vencido).
create or replace function app.daily_assignments_job()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_renewed int := 0; v_notified int := 0;
  v_days int;
  v_tz text;
begin
  for r in select e.id, e.user_id, e.valid_until from public.enrollments e join public.courses c on c.id = e.course_id
           where e.state = 'active' and e.valid_until is not null and e.valid_until - interval '30 days' <= now() and c.status = 'published' loop
    if app.supersede_and_renew(r.id, r.valid_until) is not null then v_renewed := v_renewed + 1; end if;
  end loop;
  for r in select e.id, e.user_id, e.due_at, c.title from public.enrollments e join public.courses c on c.id = e.course_id
           where e.state = 'active' and e.progress_status <> 'completed' and e.due_at is not null and e.due_at < now() + interval '8 days' loop
    v_tz := app.user_tz(r.user_id);
    v_days := (r.due_at at time zone v_tz)::date - app.local_today(v_tz);
    if v_days in (7, 3, 1) then
      perform app.notify(r.user_id, 'due_soon', case when v_days = 1 then format('«%s» vence mañana', r.title) else format('«%s» vence en %s días', r.title, v_days) end,
                         null, '/cursos/' || r.id, 'enrollment', r.id, 'due:' || r.id || ':' || v_days);
      v_notified := v_notified + 1;
    elsif v_days < 0 then
      perform app.notify(r.user_id, 'overdue', format('«%s» está vencido', r.title), 'Termínalo lo antes posible o habla con tu jefe.',
                         '/cursos/' || r.id, 'enrollment', r.id, 'overdue:' || r.id);
      v_notified := v_notified + 1;
    end if;
  end loop;
  return jsonb_build_object('renewed', v_renewed, 'notified', v_notified);
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('daily-assignments', '0 14 * * *', 'select app.daily_assignments_job()');   -- 08:00 en Ciudad de México
  end if;
end $$;

-- Lectura de asignaciones para quien puede asignar o consultar.
drop policy assignments_select on public.assignments;
create policy assignments_select on public.assignments for select to authenticated
  using (app.can_any('assignments.read') and (app.can_manage_course(course_id, 'courses.read')
         or (company_id is not null and app.can('assignments.read', company_id, branch_id, department_id))
         or exists (select 1 from public.enrollments e where e.assignment_id = assignments.id)));
