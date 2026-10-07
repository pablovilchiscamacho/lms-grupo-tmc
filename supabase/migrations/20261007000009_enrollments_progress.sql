-- =====================================================================
-- 0009 · Inscripciones, avance por lección, acceso a archivos y subida
-- Fase 2 incluye la asignación directa (lista de personas). Las reglas por
-- puesto/departamento y los usuarios futuros llegan en la Fase 4 sobre estas tablas.
-- =====================================================================

create type public.assignment_mode   as enum ('direct', 'rule');
create type public.enrollment_state  as enum ('active', 'cancelled', 'superseded');
create type public.progress_status   as enum ('not_started', 'in_progress', 'completed');
create type public.enrollment_result as enum ('none', 'pending_review', 'passed', 'failed');
create type public.lesson_status     as enum ('not_started', 'viewed', 'completed');

create table public.assignments (
  id                   uuid primary key default gen_random_uuid(),
  course_id            uuid not null references public.courses (id) on delete restrict,
  mode                 public.assignment_mode not null default 'direct',
  company_id           uuid references public.companies (id),
  branch_id            uuid references public.branches (id),
  department_id        uuid references public.departments (id),
  position_id          uuid references public.positions (id),
  user_group_id        uuid references public.user_groups (id),
  include_future_users boolean not null default false,
  requirement          public.requirement_level not null default 'mandatory',
  start_at             timestamptz,
  due_at               timestamptz,
  due_in_days          int check (due_in_days between 1 and 3650),
  expires_at           timestamptz,
  expires_in_days      int check (expires_in_days between 1 and 3650),
  allow_late_access    boolean not null default true,
  is_active            boolean not null default true,
  notes                text check (char_length(notes) <= 1000),
  created_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  constraint assignments_due_one check (due_at is null or due_in_days is null),
  constraint assignments_expiry_one check (expires_at is null or expires_in_days is null),
  constraint assignments_rule_has_criteria check (mode = 'direct' or num_nonnulls(company_id, branch_id, department_id, position_id, user_group_id) > 0)
);
create index assignments_course_idx on public.assignments (course_id) where is_active;

create table public.enrollments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete restrict,
  course_id            uuid not null references public.courses (id) on delete restrict,
  assignment_id        uuid references public.assignments (id),
  cycle                int not null default 1 check (cycle >= 1),
  course_version_id    uuid references public.course_versions (id),   -- se fija al iniciar el curso
  requirement          public.requirement_level not null default 'mandatory',
  state                public.enrollment_state not null default 'active',
  progress_status      public.progress_status not null default 'not_started',
  result               public.enrollment_result not null default 'none',
  progress_pct         numeric(5,2) not null default 0 check (progress_pct between 0 and 100),
  final_score          numeric(5,2) check (final_score between 0 and 100),
  assigned_at          timestamptz not null default now(),
  available_from       timestamptz,
  due_at               timestamptz,
  expires_at           timestamptz,
  allow_late_access    boolean not null default true,
  started_at           timestamptz,
  content_completed_at timestamptz,
  passed_at            timestamptz,
  failed_at            timestamptz,
  total_seconds        int not null default 0,
  valid_until          timestamptz,
  cancelled_at         timestamptz,
  cancelled_by         uuid references public.profiles (id),
  cancel_reason        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint enrollments_cycle_key unique (user_id, course_id, cycle),
  constraint enrollments_cancel_consistency check ((state = 'cancelled') = (cancelled_at is not null))
);
create unique index enrollments_one_active on public.enrollments (user_id, course_id) where state = 'active';
create index enrollments_user_idx on public.enrollments (user_id, state);
create index enrollments_course_idx on public.enrollments (course_id, state);
create index enrollments_version_idx on public.enrollments (course_version_id);
create index enrollments_due_idx on public.enrollments (due_at) where state = 'active' and result <> 'passed';

create table public.lesson_progress (
  id                uuid primary key default gen_random_uuid(),
  enrollment_id     uuid not null references public.enrollments (id) on delete restrict,
  lesson_id         uuid not null references public.lessons (id) on delete restrict,
  user_id           uuid not null references public.profiles (id) on delete restrict,
  status            public.lesson_status not null default 'not_started',
  first_viewed_at   timestamptz,
  completed_at      timestamptz,
  last_heartbeat_at timestamptz,
  seconds_spent     int not null default 0 check (seconds_spent >= 0),
  video_max_pct     numeric(5,2) not null default 0 check (video_max_pct between 0 and 100),
  pages_viewed      int[] not null default '{}',
  resume_state      jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now(),
  constraint lesson_progress_key unique (enrollment_id, lesson_id)
);
create index lesson_progress_user_idx on public.lesson_progress (user_id);

create trigger enrollments_updated_at before update on public.enrollments for each row execute function app.set_updated_at();
create trigger lesson_progress_updated_at before update on public.lesson_progress for each row execute function app.set_updated_at();
create trigger assignments_audit after insert or update on public.assignments for each row execute function audit.capture('assignment');
-- En inscripciones se audita todo menos el avance fino (cada segundo de video), que vive en lesson_progress.
create trigger enrollments_audit after insert or update of state, course_version_id, result, due_at, expires_at, allow_late_access, cancelled_at, content_completed_at
  on public.enrollments for each row execute function audit.capture('enrollment');
create trigger lesson_progress_audit after update of status on public.lesson_progress for each row
  when (new.status = 'completed' and old.status <> 'completed') execute function audit.capture('lesson_progress');

-- No se borra el historial académico (ni siquiera con service role desde la app).
create or replace function app.guard_no_delete()
returns trigger language plpgsql set search_path = ''
as $$ begin perform app.fail('ACADEMIC_RECORD_PROTECTED'); return null; end $$;
create trigger enrollments_no_delete before delete on public.enrollments for each row execute function app.guard_no_delete();
create trigger lesson_progress_no_delete before delete on public.lesson_progress for each row execute function app.guard_no_delete();

-- ---------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------

-- Versiones que el usuario actual puede ver como alumno: la fijada en sus inscripciones activas,
-- o la publicada vigente si todavía no empieza.
create or replace function app.my_version_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select coalesce(e.course_version_id, c.current_version_id)
  from public.enrollments e join public.courses c on c.id = e.course_id
  where e.user_id = (select auth.uid()) and e.state in ('active', 'superseded')
    and coalesce(e.course_version_id, c.current_version_id) is not null
$$;

create or replace function app.has_enrollment(p_course uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.enrollments where course_id = p_course and user_id = (select auth.uid()) and state = 'active') $$;

-- ¿Cumplió el curso? (aprobado, o completado si el curso no lleva examen)
create or replace function app.course_satisfied(p_user uuid, p_course uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.enrollments where user_id = p_user and course_id = p_course
                 and (result = 'passed' or (result = 'none' and progress_status = 'completed')))
$$;

grant execute on function app.my_version_ids(), app.has_enrollment(uuid), app.course_satisfied(uuid, uuid) to authenticated, service_role;

-- Lecciones de una versión en orden global (módulo y luego lección).
create or replace function app.ordered_lessons(p_version uuid)
returns table (lesson_id uuid, module_id uuid, ord bigint, is_required boolean)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.module_id, row_number() over (order by m.position, l.position), (l.is_required and m.is_required)
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where m.course_version_id = p_version
$$;

-- Recalcula el avance de una inscripción (Fase 3 sumará los exámenes obligatorios).
create or replace function app.recompute_enrollment(p_enrollment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.enrollments;
  v_total int; v_done int; v_pct numeric; v_min numeric; v_seconds int;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if e.course_version_id is null then return; end if;
  select count(*) filter (where o.is_required), count(*) filter (where o.is_required and lp.status = 'completed')
    into v_total, v_done
  from app.ordered_lessons(e.course_version_id) o
  left join public.lesson_progress lp on lp.lesson_id = o.lesson_id and lp.enrollment_id = e.id;
  select coalesce(sum(seconds_spent), 0) into v_seconds from public.lesson_progress where enrollment_id = e.id;
  v_pct := case when v_total = 0 then 100 else round(v_done * 100.0 / v_total, 2) end;
  select min_completion_pct into v_min from public.course_versions where id = e.course_version_id;
  update public.enrollments set
    progress_pct = v_pct,
    total_seconds = v_seconds,
    progress_status = case when v_pct >= v_min then 'completed'::public.progress_status else 'in_progress'::public.progress_status end,
    content_completed_at = case when v_pct >= v_min then coalesce(content_completed_at, now()) else null end
  where id = e.id;
end $$;

-- Inscripción del usuario actual que corresponde a una lección, con validaciones de acceso.
-- Inicia el curso (fija la versión) si es la primera vez.
create or replace function app.enrollment_for_lesson(p_lesson uuid)
returns public.enrollments language plpgsql security definer set search_path = ''
as $$
declare
  v_version uuid := app.version_of('lessons', p_lesson);
  v_course public.courses;
  e public.enrollments;
  r record;
begin
  if v_version is null then perform app.fail('NOT_FOUND', 'lesson'); end if;
  if not app.is_active_user() then perform app.fail('FORBIDDEN'); end if;
  select * into v_course from public.courses where id = app.course_of_version(v_version);
  select * into e from public.enrollments
   where user_id = (select auth.uid()) and course_id = v_course.id and state = 'active' for update;
  if not found then perform app.fail('NOT_ENROLLED'); end if;
  if v_course.status = 'suspended' then perform app.fail('COURSE_SUSPENDED'); end if;
  if v_course.status <> 'published' and e.progress_status <> 'completed' then perform app.fail('COURSE_NOT_AVAILABLE'); end if;
  if e.available_from is not null and e.available_from > now() then perform app.fail('NOT_YET_AVAILABLE'); end if;
  if e.expires_at is not null and e.expires_at < now() then perform app.fail('ACCESS_EXPIRED'); end if;
  if e.due_at is not null and e.due_at < now() and not e.allow_late_access and e.progress_status <> 'completed' then
    perform app.fail('ACCESS_EXPIRED');
  end if;

  if e.course_version_id is null then
    for r in select required_course_id from public.course_prerequisites where course_id = v_course.id loop
      if not app.course_satisfied((select auth.uid()), r.required_course_id) then
        perform app.fail('PREREQUISITE_MISSING', (select title from public.courses where id = r.required_course_id));
      end if;
    end loop;
    update public.enrollments set course_version_id = v_course.current_version_id, started_at = now(),
           progress_status = 'in_progress' where id = e.id returning * into e;
  end if;
  if e.course_version_id <> v_version then perform app.fail('NOT_ENROLLED', 'version'); end if;
  return e;
end $$;

-- ¿Puede abrir la lección? (en cursos secuenciales, todas las obligatorias anteriores deben estar completas)
create or replace function app.lesson_unlocked(p_enrollment uuid, p_version uuid, p_lesson uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select not (select sequential from public.course_versions where id = p_version)
      or not exists (
        select 1 from app.ordered_lessons(p_version) o
        left join public.lesson_progress lp on lp.lesson_id = o.lesson_id and lp.enrollment_id = p_enrollment
        where o.is_required
          and o.ord < (select ord from app.ordered_lessons(p_version) where lesson_id = p_lesson)
          and coalesce(lp.status, 'not_started') <> 'completed')
$$;

-- ¿Cumple la regla de completado?
create or replace function app.lesson_rule_met(p_lesson uuid, lp public.lesson_progress)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  l public.lessons;
  v_pages int;
begin
  select * into l from public.lessons where id = p_lesson;
  return case l.completion_rule
    when 'on_view' then lp.first_viewed_at is not null
    when 'manual' then lp.first_viewed_at is not null
    when 'min_time' then lp.seconds_spent >= l.min_seconds
    when 'video_percent' then lp.video_max_pct >= l.min_video_pct
    when 'all_pages' then (
      select f.page_count is not null and cardinality(lp.pages_viewed) >= f.page_count
      from public.lesson_contents c join public.files f on f.id = coalesce(c.pdf_file_id, c.file_id)
      where c.lesson_id = p_lesson and (c.type = 'pdf' or c.pdf_file_id is not null)
      order by c.position limit 1)
  end;
end $$;

-- ---------------------------------------------------------------------
-- RPC del alumno
-- ---------------------------------------------------------------------

-- Registra actividad en una lección: open | heartbeat. El servidor acota el tiempo y el % de video.
create or replace function public.track_lesson(p_lesson uuid, p_event text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  e public.enrollments;
  lp public.lesson_progress;
  l public.lessons;
  v_delta int := 0;
  v_page int := nullif(p_data ->> 'page', '')::int;
  v_pct numeric := nullif(p_data ->> 'video_pct', '')::numeric;
  v_dur int; v_max_pct numeric; v_pages int; v_list int[]; v_allow int;
begin
  if p_event not in ('open', 'heartbeat') then perform app.fail('VALIDATION', 'event'); end if;
  e := app.enrollment_for_lesson(p_lesson);
  select * into l from public.lessons where id = p_lesson;
  if not app.lesson_unlocked(e.id, e.course_version_id, p_lesson) then perform app.fail('LESSON_LOCKED'); end if;

  insert into public.lesson_progress (enrollment_id, lesson_id, user_id) values (e.id, p_lesson, e.user_id)
  on conflict (enrollment_id, lesson_id) do nothing;
  select * into lp from public.lesson_progress where enrollment_id = e.id and lesson_id = p_lesson for update;

  if lp.last_heartbeat_at is not null and p_event = 'heartbeat' then
    v_delta := least(greatest(extract(epoch from now() - lp.last_heartbeat_at)::int, 0), 60);
  end if;
  lp.seconds_spent := lp.seconds_spent + v_delta;
  lp.first_viewed_at := coalesce(lp.first_viewed_at, now());
  lp.last_heartbeat_at := now();
  if lp.status = 'not_started' then lp.status := 'viewed'; end if;

  -- Video: no se acepta más avance del que permite el tiempo real (hasta 1.25x de velocidad + margen).
  if v_pct is not null then
    select f.media_duration_s into v_dur from public.lesson_contents c join public.files f on f.id = c.file_id
     where c.lesson_id = p_lesson and c.type = 'video' order by c.position limit 1;
    v_max_pct := case when coalesce(v_dur, 0) > 0 then least(100, (lp.seconds_spent + 30) * 125.0 / v_dur) else 100 end;
    lp.video_max_pct := greatest(lp.video_max_pct, least(greatest(v_pct, 0), v_max_pct, 100));
  end if;
  -- PDF: páginas vistas (dentro del rango del documento). Por latido se aceptan pocas páginas nuevas,
  -- proporcional al tiempo real transcurrido (~2 s por página), para que no se pueda "marcar todo" de golpe.
  v_list := coalesce((select array_agg(x::int) from (select jsonb_array_elements_text(p_data -> 'pages') x limit 200) s), '{}');
  if v_page is not null then v_list := array_append(v_list, v_page); end if;
  if cardinality(v_list) > 0 then
    select f.page_count into v_pages from public.lesson_contents c join public.files f on f.id = coalesce(c.pdf_file_id, c.file_id)
     where c.lesson_id = p_lesson and (c.type = 'pdf' or c.pdf_file_id is not null) order by c.position limit 1;
    v_allow := greatest(3, v_delta / 2 + 3);
    foreach v_page in array v_list loop
      exit when v_allow <= 0;
      if v_page >= 1 and v_page <= coalesce(v_pages, 2000) and not (v_page = any (lp.pages_viewed)) then
        lp.pages_viewed := array_append(lp.pages_viewed, v_page);
        v_allow := v_allow - 1;
      end if;
    end loop;
  end if;
  if p_data ? 'resume' and pg_column_size(p_data -> 'resume') < 2000 then lp.resume_state := p_data -> 'resume'; end if;

  -- Completado automático para las reglas que no requieren botón.
  if lp.status <> 'completed' and l.completion_rule <> 'manual' and app.lesson_rule_met(p_lesson, lp) then
    lp.status := 'completed';
    lp.completed_at := now();
  end if;

  update public.lesson_progress set seconds_spent = lp.seconds_spent, first_viewed_at = lp.first_viewed_at,
    last_heartbeat_at = lp.last_heartbeat_at, status = lp.status, completed_at = lp.completed_at,
    video_max_pct = lp.video_max_pct, pages_viewed = lp.pages_viewed, resume_state = lp.resume_state
  where id = lp.id;
  perform app.recompute_enrollment(e.id);
  return jsonb_build_object('status', lp.status, 'seconds', lp.seconds_spent, 'video_pct', lp.video_max_pct,
                            'pages', cardinality(lp.pages_viewed), 'pages_list', to_jsonb(lp.pages_viewed));
end $$;
grant execute on function public.track_lesson(uuid, text, jsonb) to authenticated;

-- Botón "Marcar como completado". Valida la regla en el servidor.
create or replace function public.complete_lesson(p_lesson uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  e public.enrollments;
  lp public.lesson_progress;
begin
  e := app.enrollment_for_lesson(p_lesson);
  select * into lp from public.lesson_progress where enrollment_id = e.id and lesson_id = p_lesson for update;
  if not found then perform app.fail('LESSON_NOT_VIEWED'); end if;
  if lp.status = 'completed' then return jsonb_build_object('status', 'completed'); end if;
  if not app.lesson_rule_met(p_lesson, lp) then perform app.fail('LESSON_RULE_NOT_MET'); end if;
  update public.lesson_progress set status = 'completed', completed_at = now() where id = lp.id;
  perform app.recompute_enrollment(e.id);
  return jsonb_build_object('status', 'completed');
end $$;
grant execute on function public.complete_lesson(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Asignación directa (Fase 2) y cancelación
-- ---------------------------------------------------------------------
create or replace function public.admin_enroll(p_course uuid, p_user_ids uuid[], p_due_at timestamptz default null,
                                               p_requirement public.requirement_level default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_course public.courses;
  v_assignment uuid;
  u uuid;
  v_created int := 0; v_skipped int := 0; v_forbidden int := 0;
begin
  select * into v_course from public.courses where id = p_course and deleted_at is null;
  if not found then perform app.fail('NOT_FOUND', 'course'); end if;
  if v_course.status = 'archived' then perform app.fail('COURSE_ARCHIVED'); end if;
  if not app.can_any('assignments.write') then perform app.fail('FORBIDDEN', 'assignments.write'); end if;
  if coalesce(array_length(p_user_ids, 1), 0) = 0 or array_length(p_user_ids, 1) > 2000 then perform app.fail('VALIDATION', 'users'); end if;

  insert into public.assignments (course_id, mode, requirement, due_at, notes, created_by)
  values (p_course, 'direct', coalesce(p_requirement, v_course.default_requirement), p_due_at, p_notes, app.actor_id())
  returning id into v_assignment;

  foreach u in array p_user_ids loop
    if not app.can_user('assignments.write', u) or not exists (select 1 from public.profiles where id = u and status = 'active') then
      v_forbidden := v_forbidden + 1;
    elsif exists (select 1 from public.enrollments where user_id = u and course_id = p_course and state = 'active') then
      v_skipped := v_skipped + 1;
    else
      insert into public.enrollments (user_id, course_id, assignment_id, cycle, requirement, due_at)
      values (u, p_course, v_assignment,
              coalesce((select max(cycle) + 1 from public.enrollments where user_id = u and course_id = p_course), 1),
              coalesce(p_requirement, v_course.default_requirement), p_due_at);
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'forbidden', v_forbidden, 'assignment_id', v_assignment);
end $$;
grant execute on function public.admin_enroll(uuid, uuid[], timestamptz, public.requirement_level, text) to authenticated;

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
  update public.enrollments set state = 'cancelled', cancelled_at = now(), cancelled_by = app.actor_id(), cancel_reason = trim(p_reason)
  where id = e.id;
end $$;
grant execute on function public.cancel_enrollment(uuid, text) to authenticated;

-- Borrar un curso: solo si nunca tuvo inscripciones (si no, se archiva).
create or replace function public.delete_course(p_course uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app.can_manage_course(p_course, 'courses.delete') then perform app.fail('FORBIDDEN', 'courses.delete'); end if;
  if exists (select 1 from public.enrollments where course_id = p_course) then perform app.fail('COURSE_HAS_HISTORY'); end if;
  perform set_config('app.bypass_lock', 'on', true);
  update public.files set deleted_at = coalesce(deleted_at, now()), course_id = null where course_id = p_course;
  delete from public.assignments where course_id = p_course;
  update public.courses set current_version_id = null where id = p_course;
  delete from public.courses where id = p_course;
  perform set_config('app.bypass_lock', 'off', true);
end $$;
grant execute on function public.delete_course(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Archivos: preparar subida, acceso y uso de espacio
-- ---------------------------------------------------------------------
create or replace function app.file_kind(p_ext text)
returns text language sql immutable set search_path = ''
as $$
  select case lower(p_ext)
    when 'pdf' then 'document' when 'ppt' then 'document' when 'pptx' then 'document'
    when 'doc' then 'document' when 'docx' then 'document' when 'xls' then 'document' when 'xlsx' then 'document'
    when 'mp4' then 'video'
    when 'jpg' then 'image' when 'jpeg' then 'image' when 'png' then 'image' when 'webp' then 'image'
  end
$$;

-- Paso 1 de la subida: valida y reserva el registro. Si el mismo archivo ya existe (sha256 + tamaño), lo reutiliza.
create or replace function public.file_prepare_upload(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_course uuid := nullif(p ->> 'course_id', '')::uuid;
  v_ext text := lower(regexp_replace(coalesce(p ->> 'extension', ''), '^\.', ''));
  v_size bigint := (p ->> 'size_bytes')::bigint;
  v_sha text := nullif(lower(p ->> 'sha256'), '');
  v_kind text := app.file_kind(v_ext);
  v_limits jsonb := app.setting('uploads.limits');
  v_max_mb int;
  v_existing uuid;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if v_course is null or not app.can_manage_course(v_course, 'content.upload') then perform app.fail('FORBIDDEN', 'content.upload'); end if;
  if v_kind is null then perform app.fail('FILE_TYPE_NOT_ALLOWED', v_ext); end if;
  v_max_mb := coalesce((v_limits ->> (v_kind || '_mb'))::int, 50);
  if v_size is null or v_size <= 0 then perform app.fail('VALIDATION', 'size'); end if;
  if v_size > v_max_mb::bigint * 1024 * 1024 then perform app.fail('FILE_TOO_LARGE', v_max_mb::text); end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then perform app.fail('VALIDATION', 'sha256'); end if;

  if v_sha is not null then
    select f.id into v_existing from public.files f
     where f.sha256 = v_sha and f.size_bytes = v_size and f.status = 'verified' and f.deleted_at is null
       and f.bucket = 'course-content' and (f.course_id = v_course or app.can_manage_course(f.course_id, 'courses.read'))
     limit 1;
    if v_existing is not null then
      return jsonb_build_object('existing_file_id', v_existing);
    end if;
  end if;

  v_path := v_course::text || '/' || v_id::text || '.' || v_ext;
  insert into public.files (id, bucket, storage_path, original_name, extension, mime_type, size_bytes, sha256, status, course_id, uploaded_by,
                            media_duration_s, conversion_status)
  values (v_id, 'course-content', v_path, left(regexp_replace(coalesce(p ->> 'name', 'archivo'), '[\\/\x00-\x1f]', '_', 'g'), 200),
          v_ext, coalesce(nullif(p ->> 'mime_type', ''), 'application/octet-stream'), v_size, v_sha, 'pending_upload', v_course,
          app.actor_id(), nullif(p ->> 'duration_s', '')::int,
          case when v_ext in ('ppt', 'pptx', 'doc', 'docx') then 'pending' else 'not_needed' end);
  return jsonb_build_object('file_id', v_id, 'path', v_path, 'kind', v_kind,
                            'warn_large_video', v_kind = 'video' and v_size > coalesce((v_limits ->> 'video_warn_mb')::int, 300)::bigint * 1024 * 1024);
end $$;
grant execute on function public.file_prepare_upload(jsonb) to authenticated;

-- Paso 2 (solo servidor): resultado de verificar el tipo real del archivo.
create or replace function public.file_finalize(p_file uuid, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.files set
    status = case when (p ->> 'ok')::boolean then 'verified'::public.file_status else 'rejected'::public.file_status end,
    mime_type = coalesce(nullif(p ->> 'mime_type', ''), mime_type),
    page_count = coalesce(nullif(p ->> 'page_count', '')::int, page_count),
    media_duration_s = coalesce(nullif(p ->> 'duration_s', '')::int, media_duration_s),
    sha256 = coalesce(nullif(p ->> 'sha256', ''), sha256),
    conversion_status = case when not (p ->> 'ok')::boolean then 'not_needed' else conversion_status end
  where id = p_file and status = 'pending_upload';
end $$;
revoke execute on function public.file_finalize(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.file_finalize(uuid, jsonb) to service_role;

-- Conversión a PDF (solo servidor): estado del trabajo y, al terminar, registra el PDF y lo liga a los contenidos en borrador.
create or replace function public.file_conversion_update(p_file uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  f public.files;
  v_pdf uuid;
begin
  select * into f from public.files where id = p_file for update;
  if not found then perform app.fail('NOT_FOUND', 'file'); end if;
  if p ->> 'status' = 'done' then
    insert into public.files (bucket, storage_path, original_name, extension, mime_type, size_bytes, status, course_id, uploaded_by,
                              page_count, conversion_status)
    values ('course-content', p ->> 'pdf_path', regexp_replace(f.original_name, '\.[^.]+$', '') || '.pdf', 'pdf', 'application/pdf',
            (p ->> 'pdf_size')::bigint, 'verified', f.course_id, f.uploaded_by, nullif(p ->> 'page_count', '')::int, 'not_needed')
    returning id into v_pdf;
    update public.files set conversion_status = 'done', converted_pdf_id = v_pdf, conversion_error = null where id = p_file;
    update public.lesson_contents c set pdf_file_id = v_pdf
     where c.file_id = p_file and c.pdf_file_id is null
       and (select v.status from public.course_versions v join public.course_modules m on m.course_version_id = v.id
            join public.lessons l on l.module_id = m.id where l.id = c.lesson_id) = 'draft';
    return v_pdf;
  end if;
  update public.files set conversion_status = coalesce(p ->> 'status', conversion_status),
         conversion_job_id = coalesce(p ->> 'job_id', conversion_job_id), conversion_error = p ->> 'error'
  where id = p_file;
  return null;
end $$;
revoke execute on function public.file_conversion_update(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.file_conversion_update(uuid, jsonb) to service_role;

-- ¿Puede el usuario actual abrir este archivo? Devuelve dónde está (la URL firmada la genera el servidor).
create or replace function public.file_access(p_file uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  f public.files;
begin
  select * into f from public.files where id = p_file and deleted_at is null and status = 'verified';
  if not found then perform app.fail('NOT_FOUND', 'file'); end if;
  if not app.is_active_user() then perform app.fail('FORBIDDEN'); end if;
  if (f.course_id is not null and app.can_manage_course(f.course_id, 'courses.read'))
     or exists (
       select 1 from public.lesson_contents c join public.lessons l on l.id = c.lesson_id
       join public.course_modules m on m.id = l.module_id
       where (c.file_id = p_file or c.pdf_file_id = p_file) and m.course_version_id in (select app.my_version_ids()))
     or exists (select 1 from public.courses c where c.cover_file_id = p_file and (app.has_enrollment(c.id) or c.visibility = 'catalog')) then
    return jsonb_build_object('bucket', f.bucket, 'path', f.storage_path, 'mime_type', f.mime_type, 'name', f.original_name,
                              'extension', f.extension, 'size_bytes', f.size_bytes);
  end if;
  perform app.fail('FORBIDDEN');
end $$;
grant execute on function public.file_access(uuid) to authenticated;

-- Panel "Espacio usado" (§11.2)
create or replace function public.storage_usage()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_quota jsonb := coalesce(app.setting('storage.quota'), '{"gb":100,"warn_pct":80}');
begin
  if not (app.can_any('courses.read') or app.can_group('settings.manage')) then perform app.fail('FORBIDDEN'); end if;
  return jsonb_build_object(
    'used_bytes', (select coalesce(sum(size_bytes), 0) from public.files where deleted_at is null and status = 'verified'),
    'files', (select count(*) from public.files where deleted_at is null and status = 'verified'),
    'quota_gb', (v_quota ->> 'gb')::numeric, 'warn_pct', (v_quota ->> 'warn_pct')::numeric,
    'by_kind', (select coalesce(jsonb_object_agg(k, b), '{}'::jsonb) from (
        select coalesce(app.file_kind(extension), 'other') k, sum(size_bytes) b from public.files
        where deleted_at is null and status = 'verified' group by 1) s),
    'by_course', (select coalesce(jsonb_agg(x order by (x ->> 'bytes')::bigint desc), '[]'::jsonb) from (
        select jsonb_build_object('course_id', c.id, 'code', c.code, 'title', c.title, 'bytes', sum(f.size_bytes), 'files', count(*)) x
        from public.files f join public.courses c on c.id = f.course_id
        where f.deleted_at is null and f.status = 'verified' group by c.id order by sum(f.size_bytes) desc limit 15) s),
    'largest', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('id', f.id, 'name', f.original_name, 'bytes', f.size_bytes, 'course', c.code) x
        from public.files f left join public.courses c on c.id = f.course_id
        where f.deleted_at is null and f.status = 'verified' order by f.size_bytes desc limit 10) s)
  );
end $$;
grant execute on function public.storage_usage() to authenticated;

-- ---------------------------------------------------------------------
-- RLS de las tablas de la Fase 2
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categories','courses','course_instructors','course_prerequisites','course_versions','course_modules',
                           'lessons','lesson_contents','assignments','enrollments','lesson_progress']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select, insert, update on public.categories to authenticated;
create policy categories_select on public.categories for select to authenticated using (app.is_active_user());
create policy categories_write on public.categories for insert to authenticated with check (app.can_any('courses.update'));
create policy categories_update on public.categories for update to authenticated using (app.can_any('courses.update')) with check (app.can_any('courses.update'));

grant select on public.courses to authenticated;
grant update (title, description, cover_file_id, category_id, owner_department_id, default_requirement, visibility,
              estimated_minutes, issues_certificate, validity_months) on public.courses to authenticated;
create policy courses_select on public.courses for select to authenticated
  using (deleted_at is null and app.is_active_user()
         and (app.can_manage_course(id, 'courses.read') or app.has_enrollment(id)
              or (visibility = 'catalog' and status = 'published')
              or exists (select 1 from public.enrollments e where e.course_id = courses.id and e.user_id = (select auth.uid()))));
create policy courses_update on public.courses for update to authenticated
  using (app.can_manage_course(id, 'courses.update')) with check (app.can_manage_course(id, 'courses.update'));

grant select, insert, delete on public.course_instructors, public.course_prerequisites to authenticated;
create policy course_instructors_select on public.course_instructors for select to authenticated
  using (app.can_manage_course(course_id, 'courses.read') or app.has_enrollment(course_id));
create policy course_instructors_write on public.course_instructors for insert to authenticated
  with check (app.can_own_course(course_id, 'courses.update'));
create policy course_instructors_delete on public.course_instructors for delete to authenticated
  using (app.can_own_course(course_id, 'courses.update'));
create policy course_prerequisites_select on public.course_prerequisites for select to authenticated
  using (app.can_manage_course(course_id, 'courses.read') or app.has_enrollment(course_id));
create policy course_prerequisites_write on public.course_prerequisites for insert to authenticated
  with check (app.can_manage_course(course_id, 'courses.update') and app.can_manage_course(required_course_id, 'courses.read'));
create policy course_prerequisites_delete on public.course_prerequisites for delete to authenticated
  using (app.can_manage_course(course_id, 'courses.update'));

grant select on public.course_versions to authenticated;
grant update (passing_score, min_completion_pct, sequential, change_summary) on public.course_versions to authenticated;
create policy course_versions_select on public.course_versions for select to authenticated
  using (app.can_manage_course(course_id, 'courses.read') or id in (select app.my_version_ids()));
create policy course_versions_update on public.course_versions for update to authenticated
  using (app.can_manage_course(course_id, 'courses.update')) with check (app.can_manage_course(course_id, 'courses.update'));

grant select, insert, update, delete on public.course_modules, public.lessons, public.lesson_contents to authenticated;
create policy course_modules_select on public.course_modules for select to authenticated
  using (app.can_manage_course(app.course_of_version(course_version_id), 'courses.read') or course_version_id in (select app.my_version_ids()));
create policy course_modules_write on public.course_modules for all to authenticated
  using (app.can_manage_course(app.course_of_version(course_version_id), 'courses.update'))
  with check (app.can_manage_course(app.course_of_version(course_version_id), 'courses.update'));

create policy lessons_select on public.lessons for select to authenticated
  using (exists (select 1 from public.course_modules m where m.id = module_id));   -- hereda la visibilidad del módulo
create policy lessons_write on public.lessons for all to authenticated
  using (app.can_manage_course(app.course_of_version(app.version_of('lessons', id)), 'courses.update'))
  with check (app.can_manage_course(app.course_of_version((select course_version_id from public.course_modules where id = module_id)), 'courses.update'));

create policy lesson_contents_select on public.lesson_contents for select to authenticated
  using (exists (select 1 from public.lessons l where l.id = lesson_id));
create policy lesson_contents_write on public.lesson_contents for all to authenticated
  using (app.can_manage_course(app.course_of_version(app.version_of('lesson_contents', id)), 'courses.update'))
  with check (app.can_manage_course(app.course_of_version(app.version_of('lessons', lesson_id)), 'courses.update'));

drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (uploaded_by = (select auth.uid()) or app.can_group('settings.manage')
         or (course_id is not null and app.can_manage_course(course_id, 'courses.read'))
         -- el alumno ve los datos (tipo, páginas, duración) de los archivos de sus cursos; el contenido solo con URL firmada
         or exists (select 1 from public.lesson_contents c join public.lessons l on l.id = c.lesson_id
                    join public.course_modules m on m.id = l.module_id
                    where (c.file_id = files.id or c.pdf_file_id = files.id) and m.course_version_id in (select app.my_version_ids())));

grant select on public.assignments to authenticated;
create policy assignments_select on public.assignments for select to authenticated
  using (app.can_any('assignments.read') and app.can_manage_course(course_id, 'courses.read')
         or (app.can_any('assignments.read') and exists (select 1 from public.enrollments e where e.assignment_id = assignments.id)));

grant select on public.enrollments, public.lesson_progress to authenticated;
create policy enrollments_select on public.enrollments for select to authenticated
  using (user_id = (select auth.uid())
         or (app.is_active_user() and (app.can_user('progress.read', user_id)
             or (app.is_course_instructor(course_id) and app.can_any('grading.grade')))));
create policy lesson_progress_select on public.lesson_progress for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.enrollments e where e.id = enrollment_id));
