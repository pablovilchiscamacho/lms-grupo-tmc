-- =====================================================================
-- 0008 · Cursos, versiones, módulos, lecciones y contenidos
-- Regla central: una versión publicada es inmutable. Editar un curso publicado
-- crea una versión nueva (borrador) que reutiliza los mismos archivos.
-- =====================================================================

create type public.course_status      as enum ('draft', 'review', 'published', 'suspended', 'archived');
create type public.version_status     as enum ('draft', 'review', 'published', 'retired');
create type public.requirement_level  as enum ('mandatory', 'recommended', 'optional');
create type public.course_visibility  as enum ('assigned_only', 'catalog');
create type public.content_type       as enum ('text', 'pdf', 'presentation', 'video', 'image', 'document', 'spreadsheet', 'link', 'download');
create type public.completion_rule    as enum ('manual', 'on_view', 'min_time', 'video_percent', 'all_pages');

-- ---------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('course', 'question')),
  name       text not null check (char_length(trim(name)) between 2 and 80),
  slug       text not null check (slug ~ '^[a-z0-9-]{2,80}$'),
  parent_id  uuid references public.categories (id),
  created_at timestamptz not null default now(),
  constraint categories_kind_slug_key unique (kind, slug)
);

-- ---------------------------------------------------------------------
-- Cursos
-- ---------------------------------------------------------------------
create table public.courses (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  title               text not null check (char_length(trim(title)) between 3 and 160),
  description         text check (char_length(description) <= 4000),
  cover_file_id       uuid references public.files (id),
  category_id         uuid references public.categories (id),
  owner_company_id    uuid references public.companies (id),     -- nulo = curso de todo el grupo
  owner_department_id uuid references public.departments (id),
  status              public.course_status not null default 'draft',
  current_version_id  uuid,                                       -- versión publicada vigente
  default_requirement public.requirement_level not null default 'mandatory',
  visibility          public.course_visibility not null default 'assigned_only',
  estimated_minutes   int check (estimated_minutes between 1 and 10000),
  issues_certificate  boolean not null default true,
  validity_months     int check (validity_months between 1 and 120),
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  published_at        timestamptz,
  archived_at         timestamptz,
  deleted_at          timestamptz,
  search              text generated always as (app.norm(code || ' ' || title || ' ' || coalesce(description, ''))) stored,
  constraint courses_code_key unique (code)
);
create index courses_status_idx on public.courses (status) where deleted_at is null;
create index courses_owner_company_idx on public.courses (owner_company_id);
create index courses_category_idx on public.courses (category_id);
create index courses_search_trgm on public.courses using gin (search extensions.gin_trgm_ops);

create table public.course_instructors (
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete restrict,
  role      text not null default 'lead' check (role in ('lead', 'assistant')),
  added_at  timestamptz not null default now(),
  primary key (course_id, user_id)
);
create index course_instructors_user_idx on public.course_instructors (user_id);

create table public.course_prerequisites (
  course_id          uuid not null references public.courses (id) on delete cascade,
  required_course_id uuid not null references public.courses (id) on delete restrict,
  primary key (course_id, required_course_id),
  constraint course_prerequisites_not_self check (course_id <> required_course_id)
);

create table public.course_versions (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references public.courses (id) on delete cascade,
  version_number     int not null check (version_number >= 1),
  status             public.version_status not null default 'draft',
  title_snapshot     text,
  change_summary     text check (char_length(change_summary) <= 2000),
  passing_score      numeric(5,2) not null default 80 check (passing_score between 0 and 100),
  min_completion_pct numeric(5,2) not null default 100 check (min_completion_pct between 0 and 100),
  sequential         boolean not null default true,
  requires_retraining boolean not null default false,
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  submitted_by       uuid references public.profiles (id),
  submitted_at       timestamptz,
  reviewed_by        uuid references public.profiles (id),
  reviewed_at        timestamptz,
  review_notes       text,
  published_by       uuid references public.profiles (id),
  published_at       timestamptz,
  retired_at         timestamptz,
  constraint course_versions_number_key unique (course_id, version_number)
);
create unique index course_versions_one_published on public.course_versions (course_id) where status = 'published';
create unique index course_versions_one_open on public.course_versions (course_id) where status in ('draft', 'review');
alter table public.courses add constraint courses_current_version_fk foreign key (current_version_id) references public.course_versions (id);

create table public.course_modules (
  id                uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions (id) on delete cascade,
  title             text not null check (char_length(trim(title)) between 1 and 160),
  description       text check (char_length(description) <= 2000),
  position          int not null check (position >= 1),
  is_required       boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint course_modules_position_key unique (course_version_id, position) deferrable initially deferred
);

create table public.lessons (
  id                uuid primary key default gen_random_uuid(),
  module_id         uuid not null references public.course_modules (id) on delete cascade,
  title             text not null check (char_length(trim(title)) between 1 and 160),
  position          int not null check (position >= 1),
  is_required       boolean not null default true,
  completion_rule   public.completion_rule not null default 'manual',
  min_seconds       int check (min_seconds between 5 and 36000),
  min_video_pct     numeric(5,2) not null default 90 check (min_video_pct between 10 and 100),
  estimated_minutes int check (estimated_minutes between 1 and 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint lessons_position_key unique (module_id, position) deferrable initially deferred,
  constraint lessons_min_time check (completion_rule <> 'min_time' or min_seconds is not null)
);
create index lessons_module_idx on public.lessons (module_id);

create table public.lesson_contents (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons (id) on delete cascade,
  position    int not null default 1 check (position >= 1),
  type        public.content_type not null,
  body_html   text check (char_length(body_html) <= 200000),   -- sanitizado por el servidor antes de guardar
  file_id     uuid references public.files (id),
  pdf_file_id uuid references public.files (id),                 -- versión PDF de una presentación o documento
  url         text check (url is null or url ~ '^https://'),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint lesson_contents_shape check (
    (type = 'text' and body_html is not null)
    or (type = 'link' and url is not null)
    or (type not in ('text', 'link') and file_id is not null)
  )
);
create index lesson_contents_lesson_idx on public.lesson_contents (lesson_id);
create index lesson_contents_file_idx on public.lesson_contents (file_id);
create index lesson_contents_pdf_idx on public.lesson_contents (pdf_file_id);

-- Archivos: deduplicación y conversión a PDF (§11)
alter table public.files
  add column conversion_status text check (conversion_status in ('pending', 'processing', 'done', 'failed', 'not_needed')),
  add column conversion_job_id text,
  add column conversion_error  text,
  add column converted_pdf_id  uuid references public.files (id);
create index files_sha_idx on public.files (sha256, size_bytes) where status = 'verified' and deleted_at is null;
create index files_course_idx on public.files (course_id) where deleted_at is null;
alter table public.files add constraint files_course_fk foreign key (course_id) references public.courses (id);

-- ---------------------------------------------------------------------
-- Triggers: updated_at, auditoría e inmutabilidad
-- ---------------------------------------------------------------------
create trigger courses_updated_at         before update on public.courses         for each row execute function app.set_updated_at();
create trigger course_versions_updated_at before update on public.course_versions for each row execute function app.set_updated_at();
create trigger course_modules_updated_at  before update on public.course_modules  for each row execute function app.set_updated_at();
create trigger lessons_updated_at         before update on public.lessons         for each row execute function app.set_updated_at();
create trigger lesson_contents_updated_at before update on public.lesson_contents for each row execute function app.set_updated_at();

create trigger courses_audit         after insert or update or delete on public.courses         for each row execute function audit.capture('course');
create trigger course_versions_audit after insert or update or delete on public.course_versions for each row execute function audit.capture('course_version');
create trigger course_modules_audit  after insert or update or delete on public.course_modules  for each row execute function audit.capture('course_module');
create trigger lessons_audit         after insert or update or delete on public.lessons         for each row execute function audit.capture('lesson');
create trigger lesson_contents_audit after insert or update or delete on public.lesson_contents for each row execute function audit.capture('lesson_content');
create trigger course_instructors_audit after insert or delete on public.course_instructors for each row execute function audit.capture('course_instructor');
create trigger course_prerequisites_audit after insert or delete on public.course_prerequisites for each row execute function audit.capture('course_prerequisite');
create trigger files_audit           after insert or update of status, deleted_at, converted_pdf_id on public.files for each row execute function audit.capture('file');

-- Versión dueña de un módulo, lección o contenido.
create or replace function app.version_of(p_table text, p_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select case p_table
    when 'course_modules' then (select course_version_id from public.course_modules where id = p_id)
    when 'lessons' then (select m.course_version_id from public.lessons l join public.course_modules m on m.id = l.module_id where l.id = p_id)
    when 'lesson_contents' then (select m.course_version_id from public.lesson_contents c join public.lessons l on l.id = c.lesson_id
                                  join public.course_modules m on m.id = l.module_id where c.id = p_id)
  end
$$;

-- Solo se edita el contenido de versiones en borrador. Las funciones internas (clonar) pasan app.bypass_lock.
create or replace function app.guard_version_locked()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_version uuid;
  v_new_version uuid;
begin
  if current_setting('app.bypass_lock', true) = 'on' then
    return coalesce(new, old);
  end if;
  -- Se lee la fila como jsonb porque cada tabla tiene columnas distintas.
  if tg_table_name = 'course_modules' then
    v_version := (v_row ->> 'course_version_id')::uuid;
  elsif tg_table_name = 'lessons' then
    v_version := (select course_version_id from public.course_modules where id = (v_row ->> 'module_id')::uuid);
  else
    v_version := (select m.course_version_id from public.lessons l join public.course_modules m on m.id = l.module_id
                  where l.id = (v_row ->> 'lesson_id')::uuid);
  end if;
  if (select status from public.course_versions where id = v_version) is distinct from 'draft' then
    perform app.fail('VERSION_LOCKED');
  end if;
  -- Un UPDATE no puede sacar el elemento de su versión.
  if tg_op = 'UPDATE' then
    if tg_table_name = 'course_modules' then
      v_new_version := (to_jsonb(new) ->> 'course_version_id')::uuid;
      v_version := (to_jsonb(old) ->> 'course_version_id')::uuid;
    elsif tg_table_name = 'lessons' then
      v_new_version := (select course_version_id from public.course_modules where id = (to_jsonb(new) ->> 'module_id')::uuid);
      v_version := (select course_version_id from public.course_modules where id = (to_jsonb(old) ->> 'module_id')::uuid);
    else
      v_new_version := app.version_of('lessons', (to_jsonb(new) ->> 'lesson_id')::uuid);
      v_version := app.version_of('lessons', (to_jsonb(old) ->> 'lesson_id')::uuid);
    end if;
    if v_new_version is distinct from v_version then perform app.fail('VERSION_LOCKED'); end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger course_modules_lock before insert or update or delete on public.course_modules for each row execute function app.guard_version_locked();
create trigger lessons_lock        before insert or update or delete on public.lessons        for each row execute function app.guard_version_locked();
create trigger lesson_contents_lock before insert or update or delete on public.lesson_contents for each row execute function app.guard_version_locked();

-- Reglas de la versión (calificación mínima, % de avance, secuencial) tampoco cambian después de publicar.
create or replace function app.guard_version_settings()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'draft' and current_setting('app.bypass_lock', true) is distinct from 'on'
     and (new.passing_score, new.min_completion_pct, new.sequential, new.change_summary, new.course_id, new.version_number)
         is distinct from (old.passing_score, old.min_completion_pct, old.sequential, old.change_summary, old.course_id, old.version_number) then
    perform app.fail('VERSION_LOCKED');
  end if;
  return new;
end $$;
create trigger course_versions_lock before update on public.course_versions for each row execute function app.guard_version_settings();

-- Sin ciclos en prerrequisitos.
create or replace function app.check_prerequisite_cycle()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (
    with recursive req as (
      select required_course_id as id from public.course_prerequisites where course_id = new.required_course_id
      union
      select p.required_course_id from public.course_prerequisites p join req on p.course_id = req.id
    ) select 1 from req where id = new.course_id
  ) or new.required_course_id = new.course_id then
    perform app.fail('HIERARCHY_CYCLE');
  end if;
  return new;
end $$;
create trigger course_prerequisites_no_cycle before insert on public.course_prerequisites
  for each row execute function app.check_prerequisite_cycle();

-- ---------------------------------------------------------------------
-- Permisos sobre cursos
-- ---------------------------------------------------------------------
create or replace function app.is_course_instructor(p_course uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.course_instructors where course_id = p_course and user_id = (select auth.uid()))
$$;

-- Gestionar un curso: permiso con alcance sobre la empresa dueña (grupo si es de todo el grupo),
-- o ser instructor del curso y tener el permiso en algún alcance.
create or replace function app.can_manage_course(p_course uuid, p_perm text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course
      and (
        case when c.owner_company_id is null then app.can_group(p_perm) else app.can(p_perm, c.owner_company_id) end
        or (app.is_course_instructor(c.id) and app.can_any(p_perm))
      )
  )
$$;

-- Permiso sobre la empresa dueña del curso, sin contar ser instructor (para decidir quién es instructor).
create or replace function app.can_own_course(p_course uuid, p_perm text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.courses c where c.id = p_course
    and case when c.owner_company_id is null then app.can_group(p_perm) else app.can(p_perm, c.owner_company_id) end)
$$;

create or replace function app.course_of_version(p_version uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select course_id from public.course_versions where id = p_version $$;

create or replace function app.setting(p_key text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select value from public.settings where key = p_key and company_id is null $$;

grant execute on function app.is_course_instructor(uuid), app.can_manage_course(uuid, text), app.can_own_course(uuid, text), app.course_of_version(uuid),
  app.version_of(text, uuid), app.setting(text) to authenticated, service_role;

insert into public.settings (key, value) values
  ('courses.workflow', '{"require_review": false}'),
  ('uploads.limits', '{"document_mb": 200, "video_mb": 1024, "image_mb": 20, "video_warn_mb": 300}'),
  ('storage.quota', '{"gb": 100, "warn_pct": 80}');

-- ---------------------------------------------------------------------
-- RPC de cursos
-- ---------------------------------------------------------------------

-- Crear curso + versión 1 en borrador + primer módulo.
create or replace function public.create_course(p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := nullif(p ->> 'owner_company_id', '')::uuid;
  v_course uuid;
  v_version uuid;
begin
  if v_company is null then
    if not app.can_group('courses.create') then perform app.fail('FORBIDDEN', 'courses.create'); end if;
  else
    perform app.assert_can('courses.create', v_company);
  end if;
  insert into public.courses (code, title, description, category_id, owner_company_id, owner_department_id,
                              default_requirement, estimated_minutes, issues_certificate, validity_months, created_by)
  values (upper(trim(p ->> 'code')), trim(p ->> 'title'), nullif(trim(p ->> 'description'), ''),
          nullif(p ->> 'category_id', '')::uuid, v_company, nullif(p ->> 'owner_department_id', '')::uuid,
          coalesce(nullif(p ->> 'default_requirement', ''), 'mandatory')::public.requirement_level,
          nullif(p ->> 'estimated_minutes', '')::int, coalesce((p ->> 'issues_certificate')::boolean, true),
          nullif(p ->> 'validity_months', '')::int, app.actor_id())
  returning id into v_course;
  insert into public.course_versions (course_id, version_number, created_by, passing_score)
  values (v_course, 1, app.actor_id(), coalesce((app.setting('defaults.exams') ->> 'passing_score')::numeric, 80))
  returning id into v_version;
  insert into public.course_modules (course_version_id, title, position) values (v_version, 'Módulo 1', 1);
  if app.can_any('courses.create') and not app.can_group('courses.create') and app.is_active_user() then
    -- Quien crea sin alcance de grupo (por ejemplo, un instructor) queda como instructor del curso.
    insert into public.course_instructors (course_id, user_id) values (v_course, (select auth.uid())) on conflict do nothing;
  end if;
  return v_course;
end $$;
grant execute on function public.create_course(jsonb) to authenticated;

-- Versión en borrador del curso: la existente o una copia profunda de la publicada (sin duplicar archivos).
create or replace function public.create_draft_version(p_course uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_open uuid;
  v_src public.course_versions;
  v_new uuid;
  m record;
  l record;
  v_new_module uuid;
  v_new_lesson uuid;
begin
  if not app.can_manage_course(p_course, 'courses.update') then perform app.fail('FORBIDDEN', 'courses.update'); end if;
  select id into v_open from public.course_versions where course_id = p_course and status in ('draft', 'review');
  if v_open is not null then
    update public.course_versions set status = 'draft' where id = v_open and status = 'review';
    return v_open;
  end if;
  if (select status from public.courses where id = p_course) = 'archived' then perform app.fail('COURSE_ARCHIVED'); end if;
  select * into v_src from public.course_versions where course_id = p_course and status = 'published';
  if not found then perform app.fail('NOT_FOUND', 'published_version'); end if;

  perform set_config('app.bypass_lock', 'on', true);
  insert into public.course_versions (course_id, version_number, passing_score, min_completion_pct, sequential, created_by)
  values (p_course, (select max(version_number) + 1 from public.course_versions where course_id = p_course),
          v_src.passing_score, v_src.min_completion_pct, v_src.sequential, app.actor_id())
  returning id into v_new;
  for m in select * from public.course_modules where course_version_id = v_src.id order by position loop
    insert into public.course_modules (course_version_id, title, description, position, is_required)
    values (v_new, m.title, m.description, m.position, m.is_required) returning id into v_new_module;
    for l in select * from public.lessons where module_id = m.id order by position loop
      insert into public.lessons (module_id, title, position, is_required, completion_rule, min_seconds, min_video_pct, estimated_minutes)
      values (v_new_module, l.title, l.position, l.is_required, l.completion_rule, l.min_seconds, l.min_video_pct, l.estimated_minutes)
      returning id into v_new_lesson;
      insert into public.lesson_contents (lesson_id, position, type, body_html, file_id, pdf_file_id, url, metadata)
      select v_new_lesson, position, type, body_html, file_id, pdf_file_id, url, metadata
      from public.lesson_contents where lesson_id = l.id;
    end loop;
  end loop;
  perform set_config('app.bypass_lock', 'off', true);
  return v_new;
end $$;
grant execute on function public.create_draft_version(uuid) to authenticated;

-- Problemas que impiden publicar (lista vacía = se puede publicar).
create or replace function public.version_publish_issues(p_version uuid)
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare
  v_issues text[] := '{}';
  r record;
begin
  if not app.can_manage_course(app.course_of_version(p_version), 'courses.read') then perform app.fail('FORBIDDEN'); end if;
  if not exists (select 1 from public.course_modules where course_version_id = p_version) then
    v_issues := array_append(v_issues, 'El curso no tiene módulos.');
  end if;
  for r in select m.title from public.course_modules m where m.course_version_id = p_version
           and not exists (select 1 from public.lessons l where l.module_id = m.id) loop
    v_issues := array_append(v_issues, format('El módulo «%s» no tiene lecciones.', r.title));
  end loop;
  for r in select l.title from public.lessons l join public.course_modules m on m.id = l.module_id
           where m.course_version_id = p_version and not exists (select 1 from public.lesson_contents c where c.lesson_id = l.id) loop
    v_issues := array_append(v_issues, format('La lección «%s» no tiene contenido.', r.title));
  end loop;
  for r in select l.title from public.lesson_contents c join public.lessons l on l.id = c.lesson_id
           join public.course_modules m on m.id = l.module_id
           join public.files f on f.id = c.file_id
           where m.course_version_id = p_version and f.status <> 'verified' loop
    v_issues := array_append(v_issues, format('Un archivo de la lección «%s» no terminó de subirse o fue rechazado.', r.title));
  end loop;
  for r in select l.title from public.lessons l join public.course_modules m on m.id = l.module_id
           where m.course_version_id = p_version and l.completion_rule = 'all_pages'
             and not exists (select 1 from public.lesson_contents c where c.lesson_id = l.id
                             and (c.type = 'pdf' or c.pdf_file_id is not null)) loop
    v_issues := array_append(v_issues, format('La lección «%s» pide ver todas las páginas, pero no tiene PDF.', r.title));
  end loop;
  for r in select l.title from public.lessons l join public.course_modules m on m.id = l.module_id
           where m.course_version_id = p_version and l.completion_rule = 'video_percent'
             and not exists (select 1 from public.lesson_contents c where c.lesson_id = l.id and c.type = 'video') loop
    v_issues := array_append(v_issues, format('La lección «%s» pide ver el video, pero no tiene video.', r.title));
  end loop;
  return v_issues;
end $$;
grant execute on function public.version_publish_issues(uuid) to authenticated;

-- Publicar la versión abierta (borrador o en revisión). Retira la anterior en la misma transacción.
create or replace function public.publish_course_version(p_course uuid, p_change_summary text default null, p_requires_retraining boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_course public.courses;
  v_version public.course_versions;
  v_issues text[];
  v_require_review boolean := coalesce((app.setting('courses.workflow') ->> 'require_review')::boolean, false);
begin
  select * into v_course from public.courses where id = p_course for update;
  if not found then perform app.fail('NOT_FOUND', 'course'); end if;
  if not app.can_manage_course(p_course, 'courses.publish') then perform app.fail('FORBIDDEN', 'courses.publish'); end if;
  if v_course.status in ('archived', 'suspended') then perform app.fail('INVALID_TRANSITION'); end if;
  select * into v_version from public.course_versions where course_id = p_course and status in ('draft', 'review') for update;
  if not found then perform app.fail('NOT_FOUND', 'draft_version'); end if;
  if v_require_review and v_version.status <> 'review' then perform app.fail('REVIEW_REQUIRED'); end if;
  v_issues := public.version_publish_issues(v_version.id);
  if array_length(v_issues, 1) > 0 then perform app.fail('PUBLISH_BLOCKED', array_to_string(v_issues, ' | ')); end if;

  perform set_config('app.bypass_lock', 'on', true);
  update public.course_versions set status = 'retired', retired_at = now() where course_id = p_course and status = 'published';
  update public.course_versions set
    status = 'published', published_at = now(), published_by = app.actor_id(), title_snapshot = v_course.title,
    change_summary = coalesce(nullif(trim(p_change_summary), ''), change_summary),
    requires_retraining = coalesce(p_requires_retraining, false),
    reviewed_by = coalesce(reviewed_by, case when v_version.status = 'review' then app.actor_id() end),
    reviewed_at = coalesce(reviewed_at, case when v_version.status = 'review' then now() end)
  where id = v_version.id;
  perform set_config('app.bypass_lock', 'off', true);

  update public.courses set status = 'published', current_version_id = v_version.id,
         published_at = coalesce(published_at, now()) where id = p_course;
  perform app.log('course.published', 'course', p_course, v_course.owner_company_id, null,
                  jsonb_build_object('version', v_version.version_number, 'requires_retraining', p_requires_retraining));
  return v_version.id;
end $$;
grant execute on function public.publish_course_version(uuid, text, boolean) to authenticated;

-- Máquina de estados del curso (DATABASE.md §5.1). Publicar va por publish_course_version.
create or replace function public.set_course_status(p_course uuid, p_to public.course_status, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_course public.courses;
  v_perm text;
begin
  select * into v_course from public.courses where id = p_course for update;
  if not found then perform app.fail('NOT_FOUND', 'course'); end if;
  if not ((v_course.status, p_to) in (
      ('draft', 'review'), ('review', 'draft'), ('published', 'suspended'), ('suspended', 'published'),
      ('published', 'archived'), ('suspended', 'archived'), ('draft', 'archived'), ('review', 'archived'))) then
    perform app.fail('INVALID_TRANSITION', v_course.status || '→' || p_to);
  end if;
  v_perm := case p_to when 'review' then 'courses.update' when 'draft' then 'courses.review'
                      when 'suspended' then 'courses.suspend' when 'published' then 'courses.suspend' else 'courses.archive' end;
  if not app.can_manage_course(p_course, v_perm) then perform app.fail('FORBIDDEN', v_perm); end if;

  if p_to in ('review', 'draft') then
    update public.course_versions set
      status = case when p_to = 'review' then 'review'::public.version_status else 'draft'::public.version_status end,
      submitted_by = case when p_to = 'review' then app.actor_id() else submitted_by end,
      submitted_at = case when p_to = 'review' then now() else submitted_at end,
      review_notes = case when p_to = 'draft' then p_note else review_notes end
    where course_id = p_course and status in ('draft', 'review');
  end if;
  update public.courses set status = p_to, archived_at = case when p_to = 'archived' then now() else archived_at end
  where id = p_course;
  perform app.log('course.status_changed', 'course', p_course, v_course.owner_company_id,
                  jsonb_build_object('status', v_course.status), jsonb_build_object('status', p_to, 'note', p_note));
end $$;
grant execute on function public.set_course_status(uuid, public.course_status, text) to authenticated;

-- Reordenar módulos o lecciones (arrastrar y soltar): recibe los ids en el nuevo orden.
create or replace function public.reorder_items(p_kind text, p_ids uuid[])
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_version uuid;
  i int;
begin
  if p_kind not in ('module', 'lesson') or coalesce(array_length(p_ids, 1), 0) = 0 then perform app.fail('VALIDATION'); end if;
  v_version := app.version_of(case when p_kind = 'module' then 'course_modules' else 'lessons' end, p_ids[1]);
  if not app.can_manage_course(app.course_of_version(v_version), 'courses.update') then perform app.fail('FORBIDDEN'); end if;
  if p_kind = 'module' then
    if exists (select 1 from unnest(p_ids) x where app.version_of('course_modules', x) is distinct from v_version) then perform app.fail('VALIDATION'); end if;
    for i in 1 .. array_length(p_ids, 1) loop
      update public.course_modules set position = i where id = p_ids[i];
    end loop;
  else
    for i in 1 .. array_length(p_ids, 1) loop
      update public.lessons set position = i where id = p_ids[i];
    end loop;
    if (select count(distinct module_id) from public.lessons where id = any (p_ids)) > 1 then perform app.fail('VALIDATION'); end if;
  end if;
end $$;
grant execute on function public.reorder_items(text, uuid[]) to authenticated;

-- Duplicar un curso completo (como borrador nuevo, con los mismos archivos).
create or replace function public.duplicate_course(p_course uuid, p_code text, p_title text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_src public.courses;
  v_src_version uuid;
  v_new uuid;
  v_new_version uuid;
  m record; l record;
  v_mod uuid; v_les uuid;
begin
  select * into v_src from public.courses where id = p_course;
  if not found then perform app.fail('NOT_FOUND', 'course'); end if;
  if not app.can_manage_course(p_course, 'courses.read') then perform app.fail('FORBIDDEN'); end if;
  v_new := public.create_course(jsonb_build_object(
    'code', p_code, 'title', p_title, 'description', v_src.description, 'category_id', v_src.category_id,
    'owner_company_id', v_src.owner_company_id, 'owner_department_id', v_src.owner_department_id,
    'default_requirement', v_src.default_requirement, 'estimated_minutes', v_src.estimated_minutes,
    'issues_certificate', v_src.issues_certificate, 'validity_months', v_src.validity_months));
  select id into v_src_version from public.course_versions where course_id = p_course
    order by (status in ('draft', 'review')) desc, version_number desc limit 1;
  select id into v_new_version from public.course_versions where course_id = v_new;
  delete from public.course_modules where course_version_id = v_new_version;
  for m in select * from public.course_modules where course_version_id = v_src_version order by position loop
    insert into public.course_modules (course_version_id, title, description, position, is_required)
    values (v_new_version, m.title, m.description, m.position, m.is_required) returning id into v_mod;
    for l in select * from public.lessons where module_id = m.id order by position loop
      insert into public.lessons (module_id, title, position, is_required, completion_rule, min_seconds, min_video_pct, estimated_minutes)
      values (v_mod, l.title, l.position, l.is_required, l.completion_rule, l.min_seconds, l.min_video_pct, l.estimated_minutes)
      returning id into v_les;
      insert into public.lesson_contents (lesson_id, position, type, body_html, file_id, pdf_file_id, url, metadata)
      select v_les, position, type, body_html, file_id, pdf_file_id, url, metadata from public.lesson_contents where lesson_id = l.id;
    end loop;
  end loop;
  update public.courses set cover_file_id = v_src.cover_file_id where id = v_new;
  return v_new;
end $$;
grant execute on function public.duplicate_course(uuid, text, text) to authenticated;
