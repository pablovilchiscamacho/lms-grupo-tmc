-- =====================================================================
-- 0011 · Banco de preguntas y exámenes
-- Una pregunta usada (en un examen publicado o en un intento) no se edita: se crea una revisión.
-- Los exámenes pertenecen a una versión del curso y se congelan con ella (salvo activo/disponibilidad).
-- =====================================================================

create type public.question_type      as enum ('single_choice', 'multiple_choice', 'true_false', 'short_text', 'open_text', 'ordering', 'matching', 'scale');
create type public.difficulty         as enum ('easy', 'medium', 'hard');
create type public.scoring_mode       as enum ('all_or_nothing', 'partial');
create type public.scoring_policy     as enum ('best', 'last', 'average');
create type public.results_visibility as enum ('immediate', 'after_review', 'hidden');

create table public.tags (
  id   uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '^[a-z0-9áéíóúñü ._-]{2,40}$'),
  constraint tags_name_key unique (name)
);

create table public.questions (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid references public.categories (id),
  owner_company_id uuid references public.companies (id),          -- nulo = banco de todo el grupo
  type             public.question_type not null,
  prompt           text not null check (char_length(trim(prompt)) between 3 and 4000),
  explanation      text check (char_length(explanation) <= 4000),
  topic            text check (char_length(topic) <= 120),
  difficulty       public.difficulty not null default 'medium',
  default_points   numeric(7,2) not null default 10 check (default_points >= 0 and default_points <= 1000),
  scoring          public.scoring_mode not null default 'all_or_nothing',
  config           jsonb not null default '{}'::jsonb,
  revision         int not null default 1,
  supersedes_id    uuid references public.questions (id),
  is_current       boolean not null default true,
  is_locked        boolean not null default false,
  source           text not null default 'manual' check (source in ('manual', 'import', 'ai_draft')),
  ai_review_status text check (ai_review_status in ('pending_review', 'approved')),
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  search           text generated always as (app.norm(prompt || ' ' || coalesce(topic, ''))) stored
);
create index questions_category_idx on public.questions (category_id) where is_current and deleted_at is null;
create index questions_search_trgm on public.questions using gin (search extensions.gin_trgm_ops);

create table public.question_options (
  id               uuid primary key default gen_random_uuid(),
  question_id      uuid not null references public.questions (id) on delete cascade,
  position         int not null check (position >= 1),
  text             text not null check (char_length(trim(text)) between 1 and 1000),
  is_correct       boolean not null default false,
  match_target     text check (char_length(match_target) <= 1000),   -- relacionar: lado derecho
  feedback         text check (char_length(feedback) <= 1000),
  constraint question_options_position_key unique (question_id, position)
);

create table public.question_tags (
  question_id uuid not null references public.questions (id) on delete cascade,
  tag_id      uuid not null references public.tags (id) on delete cascade,
  primary key (question_id, tag_id)
);

create trigger questions_updated_at before update on public.questions for each row execute function app.set_updated_at();
create trigger questions_audit after insert or update or delete on public.questions for each row execute function audit.capture('question');

-- ---------------------------------------------------------------------
-- Exámenes
-- ---------------------------------------------------------------------
create table public.exams (
  id                        uuid primary key default gen_random_uuid(),
  course_version_id         uuid not null references public.course_versions (id) on delete cascade,
  module_id                 uuid references public.course_modules (id) on delete set null,
  title                     text not null default 'Examen final' check (char_length(trim(title)) between 2 and 160),
  instructions              text check (char_length(instructions) <= 4000),
  is_required               boolean not null default true,
  weight                    numeric(5,2) not null default 1 check (weight > 0 and weight <= 100),
  time_limit_minutes        int check (time_limit_minutes between 1 and 600),
  max_attempts              int check (max_attempts between 1 and 50),
  passing_score             numeric(5,2) not null default 80 check (passing_score between 0 and 100),
  scoring_policy            public.scoring_policy not null default 'best',
  shuffle_questions         boolean not null default true,
  shuffle_options           boolean not null default true,
  results_visibility        public.results_visibility not null default 'immediate',
  allow_review              boolean not null default true,
  show_correct_answers      boolean not null default false,
  requires_content_complete boolean not null default true,
  cooldown_minutes          int check (cooldown_minutes between 1 and 10080),
  retake_after_pass         boolean not null default false,
  available_from            timestamptz,
  available_until           timestamptz,
  is_active                 boolean not null default true,
  position                  int not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index exams_version_idx on public.exams (course_version_id);

create table public.exam_items (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  position    int not null default 1,
  points      numeric(7,2) check (points >= 0 and points <= 1000),
  constraint exam_items_question_key unique (exam_id, question_id)
);
create index exam_items_exam_idx on public.exam_items (exam_id);
create index exam_items_question_idx on public.exam_items (question_id);

create table public.exam_pools (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams (id) on delete cascade,
  category_id uuid references public.categories (id),
  difficulty  public.difficulty,
  tag_id      uuid references public.tags (id),
  topic       text,
  draw_count  int not null check (draw_count between 1 and 200),
  points_each numeric(7,2) check (points_each >= 0 and points_each <= 1000),
  position    int not null default 1
);

create trigger exams_updated_at before update on public.exams for each row execute function app.set_updated_at();
create trigger exams_audit after insert or update or delete on public.exams for each row execute function audit.capture('exam');
create trigger exam_items_audit after insert or update or delete on public.exam_items for each row execute function audit.capture('exam_item');
create trigger exam_pools_audit after insert or update or delete on public.exam_pools for each row execute function audit.capture('exam_pool');

-- Inmutabilidad: un examen de una versión no borrador solo cambia en lo operativo (activo y disponibilidad).
create or replace function app.guard_exam_locked()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_exam uuid;
  v_version uuid;
begin
  if current_setting('app.bypass_lock', true) = 'on' then return coalesce(new, old); end if;
  if tg_table_name = 'exams' then
    v_version := coalesce(new.course_version_id, old.course_version_id);
  else
    v_exam := (to_jsonb(coalesce(new, old)) ->> 'exam_id')::uuid;
    v_version := (select course_version_id from public.exams where id = v_exam);
  end if;
  if (select status from public.course_versions where id = v_version) = 'draft' then return coalesce(new, old); end if;
  if tg_table_name = 'exams' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'is_active' - 'available_from' - 'available_until' - 'updated_at')
       = (to_jsonb(old) - 'is_active' - 'available_from' - 'available_until' - 'updated_at') then
    return new;
  end if;
  perform app.fail('VERSION_LOCKED');
  return null;
end $$;
create trigger exams_lock before insert or update or delete on public.exams for each row execute function app.guard_exam_locked();
create trigger exam_items_lock before insert or update or delete on public.exam_items for each row execute function app.guard_exam_locked();
create trigger exam_pools_lock before insert or update or delete on public.exam_pools for each row execute function app.guard_exam_locked();

-- Al publicar, las preguntas fijas de la versión quedan bloqueadas (editar = nueva revisión).
create or replace function app.lock_version_questions(p_version uuid)
returns void language sql security definer set search_path = ''
as $$
  update public.questions q set is_locked = true
  from public.exam_items i join public.exams e on e.id = i.exam_id
  where i.question_id = q.id and e.course_version_id = p_version and not q.is_locked
$$;

-- ---------------------------------------------------------------------
-- Permisos del banco
-- ---------------------------------------------------------------------
create or replace function app.can_bank(p_perm text, p_company uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case when p_company is null then app.can_any(p_perm) else app.can(p_perm, p_company) or app.can_group(p_perm) end
$$;
grant execute on function app.can_bank(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Validación de preguntas por tipo
-- ---------------------------------------------------------------------
create or replace function app.validate_question(p_type public.question_type, p_config jsonb, p_options jsonb)
returns text language plpgsql immutable set search_path = ''
as $$
declare
  n int := coalesce(jsonb_array_length(p_options), 0);
  n_correct int := (select count(*) from jsonb_array_elements(coalesce(p_options, '[]')) o where coalesce((o ->> 'is_correct')::boolean, false));
  n_empty int := (select count(*) from jsonb_array_elements(coalesce(p_options, '[]')) o where coalesce(trim(o ->> 'text'), '') = '');
begin
  if n_empty > 0 then return 'Hay opciones vacías.'; end if;
  case p_type
    when 'single_choice' then
      if n < 2 then return 'Agrega al menos 2 opciones.'; end if;
      if n_correct <> 1 then return 'Marca exactamente una respuesta correcta.'; end if;
    when 'true_false' then
      if n <> 2 or n_correct <> 1 then return 'Marca si la respuesta correcta es Verdadero o Falso.'; end if;
    when 'multiple_choice' then
      if n < 2 then return 'Agrega al menos 2 opciones.'; end if;
      if n_correct < 1 then return 'Marca al menos una respuesta correcta.'; end if;
    when 'short_text' then
      if coalesce(jsonb_array_length(p_config -> 'accepted'), 0) = 0 then return 'Escribe al menos una respuesta aceptada.'; end if;
    when 'ordering' then
      if n < 2 then return 'Agrega al menos 2 elementos para ordenar.'; end if;
    when 'matching' then
      if n < 2 then return 'Agrega al menos 2 pares para relacionar.'; end if;
      if exists (select 1 from jsonb_array_elements(p_options) o where coalesce(trim(o ->> 'match_target'), '') = '') then
        return 'Cada concepto necesita su pareja.';
      end if;
    when 'scale' then
      if coalesce((p_config ->> 'min')::int, 1) >= coalesce((p_config ->> 'max')::int, 5) then return 'La escala debe ir de un número menor a uno mayor.'; end if;
    else null;
  end case;
  return null;
end $$;

-- Crear o editar una pregunta con sus opciones (todo junto). Si la pregunta ya está en uso, crea una revisión
-- y actualiza los exámenes en borrador que la usaban. Devuelve el id vigente.
create or replace function public.save_question(p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_old public.questions;
  v_company uuid := nullif(p ->> 'owner_company_id', '')::uuid;
  v_type public.question_type := (p ->> 'type')::public.question_type;
  v_options jsonb := coalesce(p -> 'options', '[]'::jsonb);
  v_config jsonb := coalesce(p -> 'config', '{}'::jsonb);
  v_err text;
  v_new uuid;
  o jsonb;
  i int := 0;
begin
  if v_type = 'true_false' and jsonb_array_length(v_options) = 0 then
    v_options := jsonb_build_array(jsonb_build_object('text', 'Verdadero', 'is_correct', coalesce((p ->> 'tf_answer')::boolean, true)),
                                   jsonb_build_object('text', 'Falso', 'is_correct', not coalesce((p ->> 'tf_answer')::boolean, true)));
  end if;
  if v_type in ('short_text', 'open_text', 'scale') then v_options := '[]'::jsonb; end if;
  v_err := app.validate_question(v_type, v_config, v_options);
  if v_err is not null then perform app.fail('QUESTION_INVALID', v_err); end if;

  if v_id is not null then
    select * into v_old from public.questions where id = v_id and deleted_at is null for update;
    if not found then perform app.fail('NOT_FOUND', 'question'); end if;
    v_company := v_old.owner_company_id;
  end if;
  if not app.can_bank('questions.write', v_company) then perform app.fail('FORBIDDEN', 'questions.write'); end if;

  if v_id is null or v_old.is_locked then
    insert into public.questions (category_id, owner_company_id, type, prompt, explanation, topic, difficulty, default_points, scoring, config,
                                  revision, supersedes_id, source, created_by)
    values (nullif(p ->> 'category_id', '')::uuid, v_company, v_type, trim(p ->> 'prompt'), nullif(trim(p ->> 'explanation'), ''),
            nullif(trim(p ->> 'topic'), ''), coalesce(nullif(p ->> 'difficulty', ''), 'medium')::public.difficulty,
            coalesce((p ->> 'default_points')::numeric, 10), coalesce(nullif(p ->> 'scoring', ''), 'all_or_nothing')::public.scoring_mode, v_config,
            coalesce(v_old.revision + 1, 1), v_old.id, coalesce(nullif(p ->> 'source', ''), 'manual'), app.actor_id())
    returning id into v_new;
    if v_old.id is not null then
      update public.questions set is_current = false where id = v_old.id;
      -- Los exámenes en borrador pasan a usar la revisión nueva; los publicados conservan la anterior.
      update public.exam_items i set question_id = v_new from public.exams e
      join public.course_versions v on v.id = e.course_version_id
      where i.exam_id = e.id and i.question_id = v_old.id and v.status = 'draft';
    end if;
  else
    v_new := v_id;
    update public.questions set category_id = nullif(p ->> 'category_id', '')::uuid, type = v_type, prompt = trim(p ->> 'prompt'),
      explanation = nullif(trim(p ->> 'explanation'), ''), topic = nullif(trim(p ->> 'topic'), ''),
      difficulty = coalesce(nullif(p ->> 'difficulty', ''), 'medium')::public.difficulty,
      default_points = coalesce((p ->> 'default_points')::numeric, 10),
      scoring = coalesce(nullif(p ->> 'scoring', ''), 'all_or_nothing')::public.scoring_mode, config = v_config
    where id = v_id;
    delete from public.question_options where question_id = v_id;
  end if;

  for o in select value from jsonb_array_elements(v_options) loop
    i := i + 1;
    insert into public.question_options (question_id, position, text, is_correct, match_target, feedback)
    values (v_new, i, trim(o ->> 'text'), coalesce((o ->> 'is_correct')::boolean, false), nullif(trim(o ->> 'match_target'), ''), nullif(trim(o ->> 'feedback'), ''));
  end loop;
  return v_new;
end $$;
grant execute on function public.save_question(jsonb) to authenticated;

create or replace function public.delete_question(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare q public.questions;
begin
  select * into q from public.questions where id = p_id;
  if not found then perform app.fail('NOT_FOUND', 'question'); end if;
  if not app.can_bank('questions.write', q.owner_company_id) then perform app.fail('FORBIDDEN'); end if;
  if exists (select 1 from public.exam_items i join public.exams e on e.id = i.exam_id join public.course_versions v on v.id = e.course_version_id
             where i.question_id = p_id and v.status = 'draft') then
    perform app.fail('QUESTION_IN_USE');
  end if;
  update public.questions set deleted_at = now(), is_current = false where id = p_id;   -- se conserva para el historial
end $$;
grant execute on function public.delete_question(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Clonado de versiones y duplicado de cursos: ahora también copian los exámenes
-- ---------------------------------------------------------------------
create or replace function app.copy_exams(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  ex record;
  v_new uuid;
begin
  for ex in select * from public.exams where course_version_id = p_from order by position loop
    insert into public.exams (course_version_id, title, instructions, is_required, weight, time_limit_minutes, max_attempts, passing_score,
      scoring_policy, shuffle_questions, shuffle_options, results_visibility, allow_review, show_correct_answers, requires_content_complete,
      cooldown_minutes, retake_after_pass, is_active, position)
    values (p_to, ex.title, ex.instructions, ex.is_required, ex.weight, ex.time_limit_minutes, ex.max_attempts, ex.passing_score,
      ex.scoring_policy, ex.shuffle_questions, ex.shuffle_options, ex.results_visibility, ex.allow_review, ex.show_correct_answers,
      ex.requires_content_complete, ex.cooldown_minutes, ex.retake_after_pass, ex.is_active, ex.position)
    returning id into v_new;
    insert into public.exam_items (exam_id, question_id, position, points)
    select v_new, question_id, position, points from public.exam_items where exam_id = ex.id;
    insert into public.exam_pools (exam_id, category_id, difficulty, tag_id, topic, draw_count, points_each, position)
    select v_new, category_id, difficulty, tag_id, topic, draw_count, points_each, position from public.exam_pools where exam_id = ex.id;
  end loop;
end $$;

-- Envoltorios: llaman a la versión original y luego copian los exámenes.
alter function public.create_draft_version(uuid) rename to create_draft_version_base;
create or replace function public.create_draft_version(p_course uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_had uuid;
  v_new uuid;
  v_src uuid;
begin
  select id into v_had from public.course_versions where course_id = p_course and status in ('draft', 'review');
  v_new := public.create_draft_version_base(p_course);
  if v_had is null then
    select id into v_src from public.course_versions where course_id = p_course and status = 'published';
    perform set_config('app.bypass_lock', 'on', true);
    perform app.copy_exams(v_src, v_new);
    perform set_config('app.bypass_lock', 'off', true);
  end if;
  return v_new;
end $$;
revoke execute on function public.create_draft_version_base(uuid) from public, anon, authenticated;
grant execute on function public.create_draft_version(uuid) to authenticated;

alter function public.duplicate_course(uuid, text, text) rename to duplicate_course_base;
create or replace function public.duplicate_course(p_course uuid, p_code text, p_title text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_new uuid;
  v_src uuid;
  v_dst uuid;
begin
  v_new := public.duplicate_course_base(p_course, p_code, p_title);
  select id into v_src from public.course_versions where course_id = p_course
    order by (status in ('draft', 'review')) desc, version_number desc limit 1;
  select id into v_dst from public.course_versions where course_id = v_new;
  perform app.copy_exams(v_src, v_dst);
  return v_new;
end $$;
revoke execute on function public.duplicate_course_base(uuid, text, text) from public, anon, authenticated;
grant execute on function public.duplicate_course(uuid, text, text) to authenticated;

-- Reporte de publicación: suma las revisiones de exámenes.
alter function public.version_publish_issues(uuid) rename to version_publish_issues_base;
create or replace function public.version_publish_issues(p_version uuid)
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare
  v_issues text[] := public.version_publish_issues_base(p_version);
  ex record;
  pl record;
  v_avail int;
begin
  for ex in select * from public.exams where course_version_id = p_version loop
    if not exists (select 1 from public.exam_items where exam_id = ex.id) and not exists (select 1 from public.exam_pools where exam_id = ex.id) then
      v_issues := array_append(v_issues, format('El examen «%s» no tiene preguntas.', ex.title));
    end if;
    if exists (select 1 from public.exam_items i join public.questions q on q.id = i.question_id
               where i.exam_id = ex.id and (q.deleted_at is not null or (q.source = 'ai_draft' and q.ai_review_status is distinct from 'approved'))) then
      v_issues := array_append(v_issues, format('El examen «%s» tiene preguntas borradas o sin revisar.', ex.title));
    end if;
    for pl in select * from public.exam_pools where exam_id = ex.id loop
      select count(*) into v_avail from public.questions q
       where q.is_current and q.deleted_at is null and (q.source <> 'ai_draft' or q.ai_review_status = 'approved')
         and (pl.category_id is null or q.category_id = pl.category_id) and (pl.difficulty is null or q.difficulty = pl.difficulty)
         and (pl.topic is null or q.topic = pl.topic)
         and (pl.tag_id is null or exists (select 1 from public.question_tags t where t.question_id = q.id and t.tag_id = pl.tag_id));
      if v_avail < pl.draw_count then
        v_issues := array_append(v_issues, format('El examen «%s» pide %s preguntas al azar, pero solo hay %s que cumplen el filtro.', ex.title, pl.draw_count, v_avail));
      end if;
    end loop;
  end loop;
  return v_issues;
end $$;
revoke execute on function public.version_publish_issues_base(uuid) from public, anon, authenticated;
grant execute on function public.version_publish_issues(uuid) to authenticated;

-- Publicar ahora también bloquea las preguntas fijas usadas por la versión.
alter function public.publish_course_version(uuid, text, boolean) rename to publish_course_version_base;
create or replace function public.publish_course_version(p_course uuid, p_change_summary text default null, p_requires_retraining boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  v := public.publish_course_version_base(p_course, p_change_summary, p_requires_retraining);
  perform app.lock_version_questions(v);
  return v;
end $$;
revoke execute on function public.publish_course_version_base(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.publish_course_version(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tags','questions','question_options','question_tags','exams','exam_items','exam_pools'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select, insert on public.tags to authenticated;
create policy tags_select on public.tags for select to authenticated using (app.can_any('questions.read'));
create policy tags_insert on public.tags for insert to authenticated with check (app.can_any('questions.write'));

-- El banco solo lo ven quienes pueden leer preguntas; los empleados nunca (reciben copias sin respuestas en sus intentos).
grant select on public.questions, public.question_options, public.question_tags to authenticated;
grant insert, delete on public.question_tags to authenticated;
create policy questions_select on public.questions for select to authenticated using (app.can_bank('questions.read', owner_company_id));
create policy question_options_select on public.question_options for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));
create policy question_tags_select on public.question_tags for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));
create policy question_tags_write on public.question_tags for insert to authenticated
  with check (exists (select 1 from public.questions q where q.id = question_id and app.can_bank('questions.write', q.owner_company_id)));
create policy question_tags_delete on public.question_tags for delete to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id and app.can_bank('questions.write', q.owner_company_id)));

grant select, insert, update, delete on public.exams, public.exam_items, public.exam_pools to authenticated;
create policy exams_select on public.exams for select to authenticated
  using (app.can_manage_course(app.course_of_version(course_version_id), 'courses.read') or course_version_id in (select app.my_version_ids()));
create policy exams_write on public.exams for all to authenticated
  using (app.can_manage_course(app.course_of_version(course_version_id), 'exams.write'))
  with check (app.can_manage_course(app.course_of_version(course_version_id), 'exams.write'));
create policy exam_items_select on public.exam_items for select to authenticated
  using (exists (select 1 from public.exams e where e.id = exam_id and app.can_manage_course(app.course_of_version(e.course_version_id), 'courses.read')));
create policy exam_items_write on public.exam_items for all to authenticated
  using (exists (select 1 from public.exams e where e.id = exam_id and app.can_manage_course(app.course_of_version(e.course_version_id), 'exams.write')))
  with check (exists (select 1 from public.exams e where e.id = exam_id and app.can_manage_course(app.course_of_version(e.course_version_id), 'exams.write'))
              and exists (select 1 from public.questions q where q.id = question_id and q.deleted_at is null));
create policy exam_pools_select on public.exam_pools for select to authenticated
  using (exists (select 1 from public.exams e where e.id = exam_id and app.can_manage_course(app.course_of_version(e.course_version_id), 'courses.read')));
create policy exam_pools_write on public.exam_pools for all to authenticated
  using (exists (select 1 from public.exams e where e.id = exam_id and app.can_manage_course(app.course_of_version(e.course_version_id), 'exams.write')))
  with check (exists (select 1 from public.exams e where e.id = exam_id and app.can_manage_course(app.course_of_version(e.course_version_id), 'exams.write')));
