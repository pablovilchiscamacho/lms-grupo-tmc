-- =====================================================================
-- 0012 · Motor de exámenes: intentos, tiempo, guardado, calificación (SECURITY.md §7)
-- El navegador nunca recibe las respuestas correctas ni decide el tiempo o la calificación.
-- =====================================================================

create type public.attempt_status as enum ('in_progress', 'submitted', 'pending_review', 'graded', 'voided');
create type public.submit_source  as enum ('user', 'timeout', 'admin');

create table public.exam_attempts (
  id                 uuid primary key default gen_random_uuid(),
  exam_id            uuid not null references public.exams (id) on delete restrict,
  enrollment_id      uuid not null references public.enrollments (id) on delete restrict,
  user_id            uuid not null references public.profiles (id) on delete restrict,
  attempt_number     int not null check (attempt_number >= 1),
  status             public.attempt_status not null default 'in_progress',
  submitted_by       public.submit_source,
  started_at         timestamptz not null default now(),
  deadline_at        timestamptz,
  submitted_at       timestamptz,
  graded_at          timestamptz,
  duration_seconds   int,
  max_points         numeric(9,2) not null default 0,
  auto_points        numeric(9,2) not null default 0,
  manual_points      numeric(9,2) not null default 0,
  score_points       numeric(9,2) not null default 0,
  score_pct          numeric(5,2),
  passed             boolean,
  session_token_hash text not null,
  client_ip          text,
  user_agent         text,
  random_seed        double precision not null,
  voided_at          timestamptz,
  voided_by          uuid references public.profiles (id),
  void_reason        text,
  constraint exam_attempts_number_key unique (enrollment_id, exam_id, attempt_number)
);
create unique index exam_attempts_one_open on public.exam_attempts (enrollment_id, exam_id) where status = 'in_progress';
create index exam_attempts_user_idx on public.exam_attempts (user_id, exam_id);
create index exam_attempts_deadline_idx on public.exam_attempts (deadline_at) where status = 'in_progress';
create index exam_attempts_pending_idx on public.exam_attempts (exam_id) where status = 'pending_review';

create table public.attempt_questions (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.exam_attempts (id) on delete restrict,
  position    int not null,
  question_id uuid not null references public.questions (id) on delete restrict,
  points      numeric(7,2) not null,
  snapshot    jsonb not null,                       -- lo que vio el empleado, sin respuestas correctas
  constraint attempt_questions_position_key unique (attempt_id, position)
);
create index attempt_questions_question_idx on public.attempt_questions (question_id);

-- Claves de respuesta: esquema privado, sin acceso por la API.
create table app.attempt_question_keys (
  attempt_question_id uuid primary key references public.attempt_questions (id) on delete restrict,
  key                 jsonb not null
);
revoke all on app.attempt_question_keys from public, anon, authenticated, service_role;

create table public.attempt_answers (
  id                  uuid primary key default gen_random_uuid(),
  attempt_question_id uuid not null references public.attempt_questions (id) on delete restrict,
  attempt_id          uuid not null references public.exam_attempts (id) on delete restrict,
  response            jsonb,
  saved_at            timestamptz not null default now(),
  revision            int not null default 1,
  auto_points         numeric(7,2),
  is_correct          boolean,
  needs_manual        boolean not null default false,
  final_points        numeric(7,2),
  graded_by           uuid references public.profiles (id),
  graded_at           timestamptz,
  constraint attempt_answers_question_key unique (attempt_question_id)
);
create index attempt_answers_attempt_idx on public.attempt_answers (attempt_id);
create index attempt_answers_manual_idx on public.attempt_answers (attempt_id) where needs_manual and final_points is null;

create table public.manual_grades (
  id         uuid primary key default gen_random_uuid(),
  answer_id  uuid not null references public.attempt_answers (id) on delete restrict,
  grader_id  uuid not null references public.profiles (id),
  score_pct  numeric(5,2) not null check (score_pct between 0 and 100),
  points     numeric(7,2) not null,
  feedback   text check (char_length(feedback) <= 4000),
  is_override boolean not null default false,
  created_at timestamptz not null default now()
);
create index manual_grades_answer_idx on public.manual_grades (answer_id, created_at desc);

create table public.attempt_events (
  id         bigint generated always as identity primary key,
  attempt_id uuid not null references public.exam_attempts (id) on delete restrict,
  type       text not null check (type in ('started', 'resumed', 'session_takeover', 'focus_lost', 'submitted', 'auto_submitted', 'voided', 'regraded')),
  at         timestamptz not null default now(),
  ip         text,
  user_agent text,
  meta       jsonb
);
create index attempt_events_attempt_idx on public.attempt_events (attempt_id, at);

create trigger exam_attempts_audit after insert or update of status, score_pct, passed, voided_at on public.exam_attempts
  for each row execute function audit.capture('exam_attempt');
create trigger manual_grades_audit after insert on public.manual_grades for each row execute function audit.capture('manual_grade');
create trigger exam_attempts_no_delete before delete on public.exam_attempts for each row execute function app.guard_no_delete();
create trigger attempt_answers_no_delete before delete on public.attempt_answers for each row execute function app.guard_no_delete();
create trigger manual_grades_no_delete before delete on public.manual_grades for each row execute function app.guard_no_delete();
create trigger attempt_questions_no_delete before delete on public.attempt_questions for each row execute function app.guard_no_delete();

-- ---------------------------------------------------------------------
-- Acceso del alumno (compartido por lecciones y exámenes)
-- ---------------------------------------------------------------------
create or replace function app.enrollment_for_version(p_version uuid)
returns public.enrollments language plpgsql security definer set search_path = ''
as $$
declare
  v_course public.courses;
  e public.enrollments;
  r record;
begin
  if p_version is null then perform app.fail('NOT_FOUND'); end if;
  if not app.is_active_user() then perform app.fail('FORBIDDEN'); end if;
  select * into v_course from public.courses where id = app.course_of_version(p_version);
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
  if e.course_version_id <> p_version then perform app.fail('NOT_ENROLLED', 'version'); end if;
  return e;
end $$;

create or replace function app.enrollment_for_lesson(p_lesson uuid)
returns public.enrollments language plpgsql security definer set search_path = ''
as $$
declare v_version uuid := app.version_of('lessons', p_lesson);
begin
  if v_version is null then perform app.fail('NOT_FOUND', 'lesson'); end if;
  return app.enrollment_for_version(v_version);
end $$;

-- ---------------------------------------------------------------------
-- Calificación
-- ---------------------------------------------------------------------
create or replace function app.norm_answer(p text, p_case boolean)
returns text language sql immutable set search_path = ''
as $$
  select regexp_replace(case when p_case then app.unaccent_i(trim(p)) else app.norm(p) end, '\s+', ' ', 'g')
$$;

-- Califica una respuesta con la clave. Devuelve {points, correct, manual}.
create or replace function app.auto_grade(p_snapshot jsonb, p_key jsonb, p_response jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_type text := p_snapshot ->> 'type';
  v_pts numeric := (p_snapshot ->> 'points')::numeric;
  v_partial boolean := p_key ->> 'scoring' = 'partial';
  v_sel text[]; v_cor text[];
  v_hits int; v_wrong int; v_n int; v_match int := 0;
  v_ok boolean;
  k text;
begin
  if p_response is null or p_response = 'null'::jsonb or p_response = '{}'::jsonb then
    return jsonb_build_object('points', 0, 'correct', case when v_type = 'scale' and not coalesce((p_key ->> 'graded')::boolean, false) then null else false end, 'manual', false);
  end if;
  case v_type
    when 'single_choice', 'true_false' then
      v_ok := (p_response ->> 'option_id') = (p_key -> 'correct' ->> 0);
      return jsonb_build_object('points', case when v_ok then v_pts else 0 end, 'correct', v_ok, 'manual', false);
    when 'multiple_choice' then
      select coalesce(array_agg(x), '{}') into v_sel from (select distinct jsonb_array_elements_text(p_response -> 'option_ids') x) s;
      select coalesce(array_agg(x), '{}') into v_cor from jsonb_array_elements_text(p_key -> 'correct') x;
      v_n := cardinality(v_cor);
      v_hits := (select count(*) from unnest(v_sel) s where s = any (v_cor));
      v_wrong := cardinality(v_sel) - v_hits;
      v_ok := v_hits = v_n and v_wrong = 0;
      return jsonb_build_object('points', case when v_partial then round(greatest(0, v_hits - v_wrong) * v_pts / greatest(v_n, 1), 2)
                                               when v_ok then v_pts else 0 end, 'correct', v_ok, 'manual', false);
    when 'short_text' then
      v_ok := exists (select 1 from jsonb_array_elements_text(p_key -> 'accepted') a
                      where app.norm_answer(a, coalesce((p_key ->> 'case_sensitive')::boolean, false))
                          = app.norm_answer(coalesce(p_response ->> 'text', ''), coalesce((p_key ->> 'case_sensitive')::boolean, false)));
      return jsonb_build_object('points', case when v_ok then v_pts else 0 end, 'correct', v_ok, 'manual', false);
    when 'open_text' then
      if coalesce(trim(p_response ->> 'text'), '') = '' then return jsonb_build_object('points', 0, 'correct', false, 'manual', false); end if;
      return jsonb_build_object('points', null, 'correct', null, 'manual', true);
    when 'ordering' then
      v_n := jsonb_array_length(p_key -> 'order');
      for i in 0 .. v_n - 1 loop
        if (p_response -> 'order' ->> i) = (p_key -> 'order' ->> i) then v_match := v_match + 1; end if;
      end loop;
      v_ok := v_match = v_n;
      return jsonb_build_object('points', case when v_partial then round(v_match * v_pts / greatest(v_n, 1), 2) when v_ok then v_pts else 0 end,
                                'correct', v_ok, 'manual', false);
    when 'matching' then
      v_n := (select count(*) from jsonb_object_keys(p_key -> 'pairs'));
      for k in select jsonb_object_keys(p_key -> 'pairs') loop
        if (p_response -> 'pairs' ->> k) = (p_key -> 'pairs' ->> k) then v_match := v_match + 1; end if;
      end loop;
      v_ok := v_match = v_n;
      return jsonb_build_object('points', case when v_partial then round(v_match * v_pts / greatest(v_n, 1), 2) when v_ok then v_pts else 0 end,
                                'correct', v_ok, 'manual', false);
    when 'scale' then
      if not coalesce((p_key ->> 'graded')::boolean, false) then return jsonb_build_object('points', 0, 'correct', null, 'manual', false); end if;
      v_ok := (p_response ->> 'value')::int between (p_key ->> 'correct_min')::int and (p_key ->> 'correct_max')::int;
      return jsonb_build_object('points', case when v_ok then v_pts else 0 end, 'correct', v_ok, 'manual', false);
    else
      return jsonb_build_object('points', 0, 'correct', false, 'manual', false);
  end case;
end $$;

-- La respuesta debe tener la forma del tipo y usar solo ids de la copia congelada.
create or replace function app.validate_response(p_snapshot jsonb, p_response jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  v_ids text[] := (select coalesce(array_agg(o ->> 'id'), '{}') from jsonb_array_elements(coalesce(p_snapshot -> 'options', '[]')) o);
  v_type text := p_snapshot ->> 'type';
  v_list text[];
begin
  if p_response is null or p_response = 'null'::jsonb then return true; end if;
  if jsonb_typeof(p_response) <> 'object' or length(p_response::text) > 12000 then return false; end if;
  case v_type
    when 'single_choice', 'true_false' then return (p_response ->> 'option_id') = any (v_ids);
    when 'multiple_choice' then
      if jsonb_typeof(p_response -> 'option_ids') <> 'array' then return false; end if;
      select coalesce(array_agg(x), '{}') into v_list from jsonb_array_elements_text(p_response -> 'option_ids') x;
      return v_list <@ v_ids and cardinality(v_list) <= cardinality(v_ids);
    when 'short_text', 'open_text' then
      return jsonb_typeof(p_response -> 'text') = 'string' and length(p_response ->> 'text') <= 10000;
    when 'ordering' then
      if jsonb_typeof(p_response -> 'order') <> 'array' then return false; end if;
      select coalesce(array_agg(x), '{}') into v_list from jsonb_array_elements_text(p_response -> 'order') x;
      return cardinality(v_list) = cardinality(v_ids) and v_list <@ v_ids and v_ids <@ v_list;
    when 'matching' then
      if jsonb_typeof(p_response -> 'pairs') <> 'object' then return false; end if;
      return not exists (select 1 from jsonb_each_text(p_response -> 'pairs') p where not (p.key = any (v_ids)) or not (p.value = any (v_ids)));
    when 'scale' then
      return jsonb_typeof(p_response -> 'value') = 'number'
         and (p_response ->> 'value')::numeric between (p_snapshot -> 'scale' ->> 'min')::numeric and (p_snapshot -> 'scale' ->> 'max')::numeric;
    else return false;
  end case;
end $$;

-- Copia congelada (lo que ve el empleado) y clave privada de una pregunta.
create or replace function app.build_snapshot(p_q uuid, p_points numeric, p_shuffle boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  q public.questions;
  v_opts jsonb; v_targets jsonb; v_key jsonb; v_snap jsonb; v_pts numeric := p_points;
begin
  select * into q from public.questions where id = p_q;
  if q.type = 'scale' and not coalesce((q.config ->> 'graded')::boolean, false) then v_pts := 0; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text) order by
           case when (p_shuffle and q.type not in ('true_false')) or q.type = 'ordering' then random() else o.position end), '[]')
    into v_opts from public.question_options o where o.question_id = q.id;
  v_snap := jsonb_build_object('type', q.type, 'prompt', q.prompt, 'points', v_pts, 'options', v_opts);
  v_key := jsonb_build_object('scoring', q.scoring, 'explanation', q.explanation);
  case q.type
    when 'single_choice', 'true_false', 'multiple_choice' then
      v_key := v_key || jsonb_build_object('correct', (select coalesce(jsonb_agg(id order by position), '[]') from public.question_options where question_id = q.id and is_correct));
      if q.type = 'multiple_choice' then v_snap := v_snap || '{"multi": true}'; end if;
    when 'ordering' then
      v_key := v_key || jsonb_build_object('order', (select jsonb_agg(id order by position) from public.question_options where question_id = q.id));
    when 'matching' then
      select jsonb_agg(jsonb_build_object('id', id, 'text', match_target) order by random()) into v_targets from public.question_options where question_id = q.id;
      v_snap := v_snap || jsonb_build_object('targets', v_targets);
      v_key := v_key || jsonb_build_object('pairs', (select jsonb_object_agg(id, id) from public.question_options where question_id = q.id));
    when 'short_text' then
      v_key := v_key || jsonb_build_object('accepted', q.config -> 'accepted', 'case_sensitive', coalesce((q.config ->> 'case_sensitive')::boolean, false));
    when 'open_text' then
      v_snap := v_snap || jsonb_build_object('max_chars', coalesce((q.config ->> 'max_chars')::int, 4000));
    when 'scale' then
      v_snap := v_snap || jsonb_build_object('scale', jsonb_build_object('min', coalesce((q.config ->> 'min')::int, 1), 'max', coalesce((q.config ->> 'max')::int, 5),
                                                                          'min_label', q.config ->> 'min_label', 'max_label', q.config ->> 'max_label'));
      v_key := v_key || jsonb_build_object('graded', coalesce((q.config ->> 'graded')::boolean, false),
                                           'correct_min', q.config -> 'correct_min', 'correct_max', q.config -> 'correct_max');
  end case;
  return jsonb_build_object('snapshot', v_snap, 'key', v_key);
end $$;

-- Totales del intento.
create or replace function app.recompute_attempt(p_attempt uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.exam_attempts;
  v_max numeric; v_auto numeric; v_manual numeric; v_score numeric; v_pending boolean; v_pct numeric; v_pass numeric;
begin
  select * into a from public.exam_attempts where id = p_attempt for update;
  if a.status in ('in_progress', 'voided') then return; end if;
  select coalesce(sum(q.points), 0),
         coalesce(sum(an.auto_points) filter (where not an.needs_manual), 0),
         coalesce(sum(an.final_points) filter (where an.needs_manual), 0),
         coalesce(sum(an.final_points), 0),
         coalesce(bool_or(an.needs_manual and an.final_points is null), false)
    into v_max, v_auto, v_manual, v_score, v_pending
  from public.attempt_questions q left join public.attempt_answers an on an.attempt_question_id = q.id
  where q.attempt_id = a.id;
  v_pct := case when v_max > 0 then round(v_score * 100.0 / v_max, 2) else 100 end;
  select passing_score into v_pass from public.exams where id = a.exam_id;
  update public.exam_attempts set max_points = v_max, auto_points = v_auto, manual_points = v_manual, score_points = v_score,
    score_pct = v_pct,
    status = case when v_pending then 'pending_review'::public.attempt_status else 'graded'::public.attempt_status end,
    passed = case when v_pending then null else v_pct >= v_pass end,
    graded_at = case when v_pending then null else coalesce(graded_at, now()) end
  where id = a.id;
end $$;

-- Calificación de un examen según su política (mejor, último o promedio).
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
  can_retry := ex.max_attempts is null or used < ex.max_attempts;
  return next;
end $$;

-- Avance y resultado de la inscripción, ahora con exámenes obligatorios (DATABASE.md §6).
create or replace function app.recompute_enrollment(p_enrollment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.enrollments;
  v_les_total int; v_les_done int; v_seconds int; v_min numeric;
  v_ex_total int := 0; v_ex_passed int := 0; v_any_failed boolean := false; v_any_pending boolean := false;
  v_wsum numeric := 0; v_wscore numeric := 0;
  v_content_ok boolean; v_pct numeric; v_result public.enrollment_result; v_done boolean;
  ex record; st record;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if e.course_version_id is null then return; end if;
  select count(*) filter (where o.is_required), count(*) filter (where o.is_required and lp.status = 'completed')
    into v_les_total, v_les_done
  from app.ordered_lessons(e.course_version_id) o
  left join public.lesson_progress lp on lp.lesson_id = o.lesson_id and lp.enrollment_id = e.id;
  select coalesce(sum(seconds_spent), 0) into v_seconds from public.lesson_progress where enrollment_id = e.id;
  select coalesce(sum(duration_seconds), 0) + v_seconds into v_seconds from public.exam_attempts where enrollment_id = e.id and status <> 'in_progress';
  select min_completion_pct into v_min from public.course_versions where id = e.course_version_id;

  for ex in select * from public.exams where course_version_id = e.course_version_id and is_required loop
    v_ex_total := v_ex_total + 1;
    select * into st from app.exam_standing(e.id, ex.id);
    if st.passed then v_ex_passed := v_ex_passed + 1; end if;
    if st.pending then v_any_pending := true; end if;
    if not st.passed and not st.pending and not st.can_retry and st.used > 0 then v_any_failed := true; end if;
    if st.score is not null then v_wsum := v_wsum + ex.weight; v_wscore := v_wscore + ex.weight * st.score; end if;
  end loop;

  v_content_ok := case when v_les_total = 0 then true else v_les_done * 100.0 / v_les_total >= v_min end;
  v_pct := case when v_les_total + v_ex_total = 0 then 100 else round((v_les_done + v_ex_passed) * 100.0 / (v_les_total + v_ex_total), 2) end;
  v_done := v_content_ok and v_ex_passed = v_ex_total;
  v_result := case
    when v_ex_total = 0 then 'none'
    when v_done then 'passed'
    when v_any_failed then 'failed'
    when v_any_pending then 'pending_review'
    else 'none' end;

  update public.enrollments set
    progress_pct = v_pct,
    total_seconds = v_seconds,
    progress_status = case when v_done then 'completed'::public.progress_status else 'in_progress'::public.progress_status end,
    content_completed_at = case when v_content_ok and v_les_total > 0 then coalesce(content_completed_at, now()) when v_les_total = 0 then content_completed_at else null end,
    result = v_result,
    final_score = case when v_wsum > 0 then round(v_wscore / v_wsum, 2) end,
    passed_at = case when v_result = 'passed' then coalesce(passed_at, now()) end,
    failed_at = case when v_result = 'failed' then coalesce(failed_at, now()) end
  where id = e.id;
end $$;

-- Cierra un intento: completa respuestas vacías, califica lo automático y manda a revisión lo manual.
create or replace function app.finalize_attempt(p_attempt uuid, p_source public.submit_source)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.exam_attempts;
  r record;
  g jsonb;
begin
  select * into a from public.exam_attempts where id = p_attempt for update;
  if a.status <> 'in_progress' then return; end if;
  insert into public.attempt_answers (attempt_question_id, attempt_id, response)
  select q.id, a.id, null from public.attempt_questions q
  where q.attempt_id = a.id and not exists (select 1 from public.attempt_answers x where x.attempt_question_id = q.id);
  for r in select an.id, q.snapshot, k.key, an.response from public.attempt_answers an
           join public.attempt_questions q on q.id = an.attempt_question_id
           join app.attempt_question_keys k on k.attempt_question_id = q.id
           where an.attempt_id = a.id loop
    g := app.auto_grade(r.snapshot, r.key, r.response);
    update public.attempt_answers set auto_points = (g ->> 'points')::numeric, is_correct = (g ->> 'correct')::boolean,
      needs_manual = (g ->> 'manual')::boolean,
      final_points = case when (g ->> 'manual')::boolean then null else (g ->> 'points')::numeric end
    where id = r.id;
  end loop;
  update public.exam_attempts set status = 'submitted', submitted_by = p_source,
    submitted_at = case when p_source = 'timeout' and deadline_at is not null then least(now(), deadline_at) else now() end,
    duration_seconds = extract(epoch from (case when p_source = 'timeout' and deadline_at is not null then least(now(), deadline_at) else now() end) - started_at)::int
  where id = a.id;
  insert into public.attempt_events (attempt_id, type) values (a.id, case when p_source = 'timeout' then 'auto_submitted' else 'submitted' end);
  perform app.recompute_attempt(a.id);
  perform app.recompute_enrollment(a.enrollment_id);
end $$;

-- pg_cron: entrega y califica los intentos cuyo tiempo venció (aunque el navegador esté cerrado).
create or replace function app.close_expired_attempts()
returns int language plpgsql security definer set search_path = ''
as $$
declare r record; n int := 0;
begin
  for r in select id from public.exam_attempts where status = 'in_progress' and deadline_at is not null and deadline_at + interval '30 seconds' < now() loop
    perform app.finalize_attempt(r.id, 'timeout');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- RPC del alumno
-- ---------------------------------------------------------------------
create or replace function app.token_hash(p_token text)
returns text language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

create or replace function app.attempt_payload(p_attempt uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'attempt_id', a.id, 'attempt_number', a.attempt_number, 'exam_id', a.exam_id, 'title', e.title,
    'deadline_at', a.deadline_at, 'server_now', now(), 'status', a.status,
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'position', q.position, 'snapshot', q.snapshot, 'response', an.response) order by q.position), '[]')
                  from public.attempt_questions q left join public.attempt_answers an on an.attempt_question_id = q.id
                  where q.attempt_id = a.id))
  from public.exam_attempts a join public.exams e on e.id = a.exam_id where a.id = p_attempt
$$;

-- Inicia (o reanuda) un intento. El token de sesión identifica el dispositivo: el último en abrir se queda con el intento.
create or replace function public.start_attempt(p_exam uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  ex public.exams;
  e public.enrollments;
  a public.exam_attempts;
  st record;
  v_ip text := left(coalesce(app.request_header('x-client-ip'), ''), 64);
  v_ua text := left(coalesce(app.request_header('x-client-ua'), ''), 400);
  v_last timestamptz;
  v_qids uuid[] := '{}'; v_pts numeric[] := '{}';
  pl record; it record; q record;
  v_order int[]; v_seed double precision := random();
  i int; b jsonb; v_aq uuid;
begin
  if length(coalesce(p_token, '')) < 20 then perform app.fail('VALIDATION', 'token'); end if;
  select * into ex from public.exams where id = p_exam;
  if not found then perform app.fail('NOT_FOUND', 'exam'); end if;
  e := app.enrollment_for_version(ex.course_version_id);
  if not ex.is_active or (ex.available_from is not null and ex.available_from > now()) or (ex.available_until is not null and ex.available_until < now()) then
    perform app.fail('EXAM_NOT_AVAILABLE');
  end if;

  -- ¿Ya hay uno abierto? Si venció se cierra; si no, se reanuda en este dispositivo.
  select * into a from public.exam_attempts where enrollment_id = e.id and exam_id = ex.id and status = 'in_progress' for update;
  if found then
    if a.deadline_at is not null and a.deadline_at + interval '30 seconds' < now() then
      perform app.finalize_attempt(a.id, 'timeout');
    else
      insert into public.attempt_events (attempt_id, type, ip, user_agent)
      values (a.id, case when a.session_token_hash = app.token_hash(p_token) then 'resumed' else 'session_takeover' end, v_ip, v_ua);
      update public.exam_attempts set session_token_hash = app.token_hash(p_token) where id = a.id;
      return app.attempt_payload(a.id) || '{"resumed": true}';
    end if;
  end if;

  if ex.requires_content_complete and exists (
       select 1 from app.ordered_lessons(e.course_version_id) o
       left join public.lesson_progress lp on lp.lesson_id = o.lesson_id and lp.enrollment_id = e.id
       where o.is_required and coalesce(lp.status, 'not_started') <> 'completed') then
    perform app.fail('CONTENT_NOT_COMPLETE');
  end if;
  select * into st from app.exam_standing(e.id, ex.id);
  if st.passed and not ex.retake_after_pass then perform app.fail('ALREADY_PASSED'); end if;
  if st.pending then perform app.fail('ATTEMPT_PENDING_REVIEW'); end if;
  if not st.can_retry then perform app.fail('NO_ATTEMPTS_LEFT'); end if;
  select max(submitted_at) into v_last from public.exam_attempts where enrollment_id = e.id and exam_id = ex.id and status <> 'voided';
  if ex.cooldown_minutes is not null and v_last is not null and v_last + make_interval(mins => ex.cooldown_minutes) > now() then
    perform app.fail('COOLDOWN', ceil(extract(epoch from (v_last + make_interval(mins => ex.cooldown_minutes) - now())) / 60)::int::text);
  end if;

  -- Selección de preguntas: fijas y luego al azar de los grupos (sin repetir).
  for it in select i.question_id, coalesce(i.points, q2.default_points) pts from public.exam_items i
            join public.questions q2 on q2.id = i.question_id where i.exam_id = ex.id order by i.position loop
    v_qids := v_qids || it.question_id; v_pts := v_pts || it.pts;
  end loop;
  for pl in select * from public.exam_pools where exam_id = ex.id order by position loop
    for q in select q3.id, coalesce(pl.points_each, q3.default_points) pts from public.questions q3
             where q3.is_current and q3.deleted_at is null and (q3.source <> 'ai_draft' or q3.ai_review_status = 'approved')
               and (pl.category_id is null or q3.category_id = pl.category_id) and (pl.difficulty is null or q3.difficulty = pl.difficulty)
               and (pl.topic is null or q3.topic = pl.topic)
               and (pl.tag_id is null or exists (select 1 from public.question_tags t where t.question_id = q3.id and t.tag_id = pl.tag_id))
               and not (q3.id = any (v_qids))
             order by random() limit pl.draw_count loop
      v_qids := v_qids || q.id; v_pts := v_pts || q.pts;
    end loop;
  end loop;
  if cardinality(v_qids) = 0 then perform app.fail('EXAM_EMPTY'); end if;
  select array_agg(n order by case when ex.shuffle_questions then random() else n end) into v_order from generate_series(1, cardinality(v_qids)) n;

  insert into public.exam_attempts (exam_id, enrollment_id, user_id, attempt_number, deadline_at, session_token_hash, client_ip, user_agent, random_seed)
  values (ex.id, e.id, e.user_id,
          coalesce((select max(attempt_number) from public.exam_attempts where enrollment_id = e.id and exam_id = ex.id), 0) + 1,
          (select min(x) from unnest(array[case when ex.time_limit_minutes is not null then now() + make_interval(mins => ex.time_limit_minutes) end,
                                           ex.available_until, e.expires_at]) x),
          app.token_hash(p_token), v_ip, v_ua, v_seed)
  returning * into a;
  for i in 1 .. cardinality(v_order) loop
    b := app.build_snapshot(v_qids[v_order[i]], v_pts[v_order[i]], ex.shuffle_options);
    insert into public.attempt_questions (attempt_id, position, question_id, points, snapshot)
    values (a.id, i, v_qids[v_order[i]], (b -> 'snapshot' ->> 'points')::numeric, b -> 'snapshot') returning id into v_aq;
    insert into app.attempt_question_keys (attempt_question_id, key) values (v_aq, b -> 'key');
  end loop;
  update public.questions set is_locked = true where id = any (v_qids) and not is_locked;
  insert into public.attempt_events (attempt_id, type, ip, user_agent) values (a.id, 'started', v_ip, v_ua);
  return app.attempt_payload(a.id) || '{"resumed": false}';
end $$;
grant execute on function public.start_attempt(uuid, text) to authenticated;

-- Autoguardado de una respuesta. Si el tiempo ya venció, cierra el intento y lo informa (no lanza error para no deshacer el cierre).
create or replace function public.save_answer(p_attempt uuid, p_question uuid, p_response jsonb, p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  a public.exam_attempts;
  q public.attempt_questions;
begin
  select * into a from public.exam_attempts where id = p_attempt for update;
  if not found or a.user_id <> (select auth.uid()) then perform app.fail('NOT_FOUND', 'attempt'); end if;
  if a.status <> 'in_progress' then return jsonb_build_object('closed', true); end if;
  if a.session_token_hash <> app.token_hash(p_token) then perform app.fail('SESSION_CONFLICT'); end if;
  if a.deadline_at is not null and now() > a.deadline_at + interval '30 seconds' then
    perform app.finalize_attempt(a.id, 'timeout');
    return jsonb_build_object('closed', true, 'expired', true);
  end if;
  select * into q from public.attempt_questions where id = p_question and attempt_id = a.id;
  if not found then perform app.fail('NOT_FOUND', 'question'); end if;
  if not app.validate_response(q.snapshot, p_response) then perform app.fail('RESPONSE_INVALID'); end if;
  insert into public.attempt_answers (attempt_question_id, attempt_id, response) values (q.id, a.id, p_response)
  on conflict (attempt_question_id) do update set response = excluded.response, saved_at = now(), revision = public.attempt_answers.revision + 1;
  return jsonb_build_object('saved_at', now());
end $$;
grant execute on function public.save_answer(uuid, uuid, jsonb, text) to authenticated;

create or replace function public.log_attempt_event(p_attempt uuid, p_type text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_type <> 'focus_lost' then perform app.fail('VALIDATION'); end if;
  if not exists (select 1 from public.exam_attempts where id = p_attempt and user_id = (select auth.uid()) and status = 'in_progress') then return; end if;
  -- Como máximo un registro por minuto: es una señal, no una acusación.
  if not exists (select 1 from public.attempt_events where attempt_id = p_attempt and type = 'focus_lost' and at > now() - interval '1 minute') then
    insert into public.attempt_events (attempt_id, type) values (p_attempt, 'focus_lost');
  end if;
end $$;
grant execute on function public.log_attempt_event(uuid, text) to authenticated;

-- Resultado del intento para el propio empleado, respetando la visibilidad configurada.
create or replace function public.my_attempt_result(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  a public.exam_attempts;
  ex public.exams;
  v_show boolean;
  v_review jsonb;
begin
  select * into a from public.exam_attempts where id = p_attempt;
  if not found or a.user_id <> (select auth.uid()) then perform app.fail('NOT_FOUND', 'attempt'); end if;
  select * into ex from public.exams where id = a.exam_id;
  v_show := ex.results_visibility = 'immediate' or (ex.results_visibility = 'after_review' and a.status = 'graded');
  if v_show and ex.allow_review and a.status in ('graded', 'pending_review') then
    select jsonb_agg(jsonb_build_object(
      'position', q.position, 'prompt', q.snapshot ->> 'prompt', 'type', q.snapshot ->> 'type', 'snapshot', q.snapshot,
      'response', an.response, 'points', q.points, 'earned', an.final_points, 'correct', an.is_correct, 'pending', an.needs_manual and an.final_points is null,
      'feedback', (select mg.feedback from public.manual_grades mg where mg.answer_id = an.id order by mg.created_at desc limit 1),
      'answer_key', case when ex.show_correct_answers then k.key - 'scoring' end
    ) order by q.position) into v_review
    from public.attempt_questions q
    left join public.attempt_answers an on an.attempt_question_id = q.id
    left join app.attempt_question_keys k on k.attempt_question_id = q.id
    where q.attempt_id = a.id;
  end if;
  return jsonb_build_object(
    'attempt_id', a.id, 'attempt_number', a.attempt_number, 'status', a.status, 'submitted_by', a.submitted_by,
    'submitted_at', a.submitted_at, 'duration_seconds', a.duration_seconds, 'exam_title', ex.title, 'passing_score', ex.passing_score,
    'visible', v_show, 'score_pct', case when v_show then a.score_pct end, 'passed', case when v_show then a.passed end,
    'review', v_review);
end $$;
grant execute on function public.my_attempt_result(uuid) to authenticated;

-- Exámenes de un curso para el empleado: configuración visible, intentos y si puede presentar.
create or replace function public.my_course_exams(p_enrollment uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  e public.enrollments;
  v_version uuid;
  v_content_done boolean;
begin
  select * into e from public.enrollments where id = p_enrollment and user_id = (select auth.uid());
  if not found then perform app.fail('NOT_FOUND', 'enrollment'); end if;
  v_version := coalesce(e.course_version_id, (select current_version_id from public.courses where id = e.course_id));
  v_content_done := not exists (
    select 1 from app.ordered_lessons(v_version) o
    left join public.lesson_progress lp on lp.lesson_id = o.lesson_id and lp.enrollment_id = e.id
    where o.is_required and coalesce(lp.status, 'not_started') <> 'completed');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ex.id, 'title', ex.title, 'instructions', ex.instructions, 'is_required', ex.is_required,
      'time_limit_minutes', ex.time_limit_minutes, 'max_attempts', ex.max_attempts, 'passing_score', ex.passing_score,
      'scoring_policy', ex.scoring_policy, 'is_active', ex.is_active, 'cooldown_minutes', ex.cooldown_minutes,
      'question_count', (select count(*) from public.exam_items where exam_id = ex.id) + (select coalesce(sum(draw_count), 0) from public.exam_pools where exam_id = ex.id),
      'locked', ex.requires_content_complete and not v_content_done,
      'used', st.used, 'passed', st.passed, 'pending', st.pending, 'can_retry', st.can_retry,
      'score', case when ex.results_visibility <> 'hidden' then st.score end,
      'open_attempt', (select id from public.exam_attempts where enrollment_id = e.id and exam_id = ex.id and status = 'in_progress'),
      'attempts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'number', a.attempt_number, 'status', a.status,
                     'submitted_at', a.submitted_at,
                     'score_pct', case when ex.results_visibility = 'immediate' or (ex.results_visibility = 'after_review' and a.status = 'graded') then a.score_pct end,
                     'passed', case when ex.results_visibility = 'immediate' or (ex.results_visibility = 'after_review' and a.status = 'graded') then a.passed end)
                   order by a.attempt_number), '[]')
                   from public.exam_attempts a where a.enrollment_id = e.id and a.exam_id = ex.id and a.status <> 'voided')
    ) order by ex.position)
    from public.exams ex cross join lateral app.exam_standing(e.id, ex.id) st
    where ex.course_version_id = v_version), '[]'::jsonb);
end $$;
grant execute on function public.my_course_exams(uuid) to authenticated;

create or replace function public.submit_attempt(p_attempt uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare a public.exam_attempts;
begin
  select * into a from public.exam_attempts where id = p_attempt for update;
  if not found or a.user_id <> (select auth.uid()) then perform app.fail('NOT_FOUND', 'attempt'); end if;
  if a.status = 'in_progress' then
    if a.session_token_hash <> app.token_hash(p_token) then perform app.fail('SESSION_CONFLICT'); end if;
    perform app.finalize_attempt(a.id, case when a.deadline_at is not null and now() > a.deadline_at + interval '30 seconds' then 'timeout' else 'user' end::public.submit_source);
  end if;
  return jsonb_build_object('attempt_id', a.id);
end $$;
grant execute on function public.submit_attempt(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Calificación manual
-- ---------------------------------------------------------------------
create or replace function app.can_grade(p_attempt uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.exam_attempts a join public.enrollments e on e.id = a.enrollment_id
    where a.id = p_attempt and a.user_id <> (select auth.uid())
      and (app.can_user('grading.grade', a.user_id) or (app.is_course_instructor(e.course_id) and app.can_any('grading.grade'))))
$$;
grant execute on function app.can_grade(uuid) to authenticated, service_role;

create or replace function public.grade_answer(p_answer uuid, p_pct numeric, p_feedback text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  an public.attempt_answers;
  a public.exam_attempts;
  q public.attempt_questions;
  v_override boolean;
  v_points numeric;
begin
  select * into an from public.attempt_answers where id = p_answer for update;
  if not found then perform app.fail('NOT_FOUND', 'answer'); end if;
  select * into a from public.exam_attempts where id = an.attempt_id for update;
  if not app.can_grade(a.id) then perform app.fail('FORBIDDEN', 'grading.grade'); end if;
  if a.status not in ('pending_review', 'graded') then perform app.fail('ATTEMPT_NOT_GRADABLE'); end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then perform app.fail('VALIDATION', '{"pct":"invalid"}'); end if;
  v_override := not an.needs_manual;
  if v_override and not app.can_user('grading.override', a.user_id) then perform app.fail('FORBIDDEN', 'grading.override'); end if;
  if v_override and coalesce(trim(p_feedback), '') = '' then perform app.fail('VALIDATION', '{"feedback":"required"}'); end if;
  select * into q from public.attempt_questions where id = an.attempt_question_id;
  v_points := round(p_pct * q.points / 100, 2);
  insert into public.manual_grades (answer_id, grader_id, score_pct, points, feedback, is_override)
  values (an.id, app.actor_id(), p_pct, v_points, nullif(trim(p_feedback), ''), v_override);
  update public.attempt_answers set final_points = v_points, graded_by = app.actor_id(), graded_at = now(),
         is_correct = case when an.needs_manual then p_pct >= 50 else is_correct end
  where id = an.id;
  if a.status = 'graded' then
    insert into public.attempt_events (attempt_id, type, meta) values (a.id, 'regraded', jsonb_build_object('answer', an.id));
  end if;
  perform app.recompute_attempt(a.id);
  perform app.recompute_enrollment(a.enrollment_id);
end $$;
grant execute on function public.grade_answer(uuid, numeric, text) to authenticated;

create or replace function public.void_attempt(p_attempt uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.exam_attempts;
begin
  select * into a from public.exam_attempts where id = p_attempt for update;
  if not found then perform app.fail('NOT_FOUND', 'attempt'); end if;
  if not app.can_user('grading.override', a.user_id) or a.user_id = (select auth.uid()) then perform app.fail('FORBIDDEN', 'grading.override'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', '{"reason":"required"}'); end if;
  if a.status = 'voided' then return; end if;
  update public.exam_attempts set status = 'voided', voided_at = now(), voided_by = app.actor_id(), void_reason = trim(p_reason), passed = null where id = a.id;
  insert into public.attempt_events (attempt_id, type, meta) values (a.id, 'voided', jsonb_build_object('reason', trim(p_reason)));
  perform app.recompute_enrollment(a.enrollment_id);
end $$;
grant execute on function public.void_attempt(uuid, text) to authenticated;

-- Bandeja "Exámenes pendientes de revisión" (§13), filtrada por lo que el usuario puede calificar.
create or replace function public.pending_reviews(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.can_any('grading.grade') then perform app.fail('FORBIDDEN', 'grading.grade'); end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'submitted_at')) from (
      select jsonb_build_object(
        'answer_id', an.id, 'attempt_id', a.id, 'attempt_number', a.attempt_number, 'submitted_at', a.submitted_at,
        'user', jsonb_build_object('id', p.id, 'full_name', p.full_name, 'employee_number', p.employee_number),
        'course', c.title, 'exam', ex.title, 'prompt', q.snapshot ->> 'prompt', 'points', q.points,
        'rubric', (select config ->> 'rubric' from public.questions where id = q.question_id),
        'response', an.response ->> 'text') x
      from public.attempt_answers an
      join public.exam_attempts a on a.id = an.attempt_id
      join public.attempt_questions q on q.id = an.attempt_question_id
      join public.exams ex on ex.id = a.exam_id
      join public.enrollments e on e.id = a.enrollment_id
      join public.courses c on c.id = e.course_id
      join public.profiles p on p.id = a.user_id
      where an.needs_manual and an.final_points is null and a.status = 'pending_review' and app.can_grade(a.id)
      limit least(greatest(p_limit, 1), 500)) s), '[]'::jsonb);
end $$;
grant execute on function public.pending_reviews(int) to authenticated;

-- ---------------------------------------------------------------------
-- RLS: los empleados no leen estas tablas (usan las RPC de arriba); evaluadores y seguimiento sí.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['exam_attempts','attempt_questions','attempt_answers','manual_grades','attempt_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy exam_attempts_select on public.exam_attempts for select to authenticated
  using (app.is_active_user() and (app.can_user('progress.read', user_id) or app.can_grade(id)));
create policy attempt_questions_select on public.attempt_questions for select to authenticated
  using (exists (select 1 from public.exam_attempts a where a.id = attempt_id));
create policy attempt_answers_select on public.attempt_answers for select to authenticated
  using (exists (select 1 from public.exam_attempts a where a.id = attempt_id));
create policy manual_grades_select on public.manual_grades for select to authenticated
  using (exists (select 1 from public.attempt_answers an where an.id = answer_id));
create policy attempt_events_select on public.attempt_events for select to authenticated
  using (exists (select 1 from public.exam_attempts a where a.id = attempt_id));

-- Cierre automático por tiempo cada minuto.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('close-expired-attempts', '* * * * *', 'select app.close_expired_attempts()');
  end if;
end $$;
