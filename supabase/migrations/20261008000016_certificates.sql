-- ============================================================================
-- 0016 · Constancias (Fase 6)
-- Se emiten solas al aprobar (o terminar, si el curso no tiene examen) un curso que da constancia.
-- Folio consecutivo por año (TMC-2026-000001) y código de verificación aleatorio de 16 caracteres
-- que es lo que lleva el QR: no es adivinable ni enumerable. Nunca se borran: se revocan con motivo.
-- El PDF se genera una sola vez (servidor, service role) y se guarda con su sha256.
-- ============================================================================

create type public.certificate_status as enum ('valid', 'revoked');

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'course_assigned', 'due_soon', 'overdue', 'course_passed', 'course_failed', 'course_completed',
  'attempt_graded', 'retraining', 'renewal', 'extension', 'extra_attempts', 'cancelled', 'certificate_ready'));

create table app.certificate_counters (
  year int primary key,
  last int not null default 0
);

create table public.certificates (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique,
  verification_code text not null unique check (verification_code ~ '^[A-Z2-9]{16}$'),
  enrollment_id     uuid not null unique references public.enrollments (id) on delete restrict,
  user_id           uuid not null references public.profiles (id) on delete restrict,
  course_id         uuid not null references public.courses (id) on delete restrict,
  course_version_id uuid references public.course_versions (id),
  -- Copias al momento de emitir: la constancia no cambia si después cambia el nombre del curso o de la persona.
  holder_name       text not null,
  course_title      text not null,
  course_code       text not null,
  instructor_name   text,
  company_name      text not null,
  company_id        uuid not null references public.companies (id),
  score             numeric(5,2),
  duration_minutes  int,
  issued_at         timestamptz not null default now(),
  expires_at        timestamptz,
  signer_name       text,
  signer_title      text,
  pdf_file_id       uuid references public.files (id),
  pdf_sha256        text,
  status            public.certificate_status not null default 'valid',
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles (id),
  revoked_reason    text,
  created_at        timestamptz not null default now(),
  constraint certificates_revoked_consistency check ((status = 'revoked') = (revoked_at is not null and revoked_reason is not null))
);
create index certificates_user_idx on public.certificates (user_id, issued_at desc);
create index certificates_course_idx on public.certificates (course_id);
create index certificates_issued_idx on public.certificates (issued_at desc);

alter table public.certificates enable row level security;
revoke all on public.certificates from anon, authenticated;
grant select on public.certificates to authenticated;
create policy certificates_select on public.certificates for select to authenticated
  using (user_id = (select auth.uid()) or app.can_user('certificates.read', user_id));

create trigger certificates_audit after insert or update on public.certificates for each row execute function audit.capture('certificate');
create trigger certificates_no_delete before delete on public.certificates for each row execute function app.guard_no_delete();

insert into public.settings (key, value) values
  ('certificates', '{"prefix": "TMC", "signer_name": "", "signer_title": "Capacitación · Grupo TMC"}')
on conflict do nothing;

-- 16 caracteres sin los que se confunden (sin 0/O ni 1/I). 32 símbolos = 5 bits cada uno = 80 bits.
create or replace function app.random_code(p_len int default 16)
returns text language plpgsql volatile set search_path = ''
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8'));
  v text := '';
begin
  for i in 0 .. p_len - 1 loop
    v := v || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v;
end $$;

-- Emite la constancia de una inscripción terminada (idempotente). Devuelve el id o null si no aplica.
create or replace function app.issue_certificate(p_enrollment uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  e public.enrollments;
  c public.courses;
  p public.profiles;
  v_cfg jsonb := coalesce(app.setting('certificates'), '{}');
  v_year int := extract(year from (now() at time zone 'America/Mexico_City'))::int;
  v_seq int;
  v_id uuid;
  v_code text;
begin
  select * into e from public.enrollments where id = p_enrollment;
  if not found or e.progress_status <> 'completed' or e.result not in ('passed', 'none') then return null; end if;
  select id into v_id from public.certificates where enrollment_id = e.id;
  if found then return v_id; end if;
  select * into c from public.courses where id = e.course_id;
  if not c.issues_certificate then return null; end if;
  select * into p from public.profiles where id = e.user_id;

  insert into app.certificate_counters as k (year, last) values (v_year, 1)
  on conflict (year) do update set last = k.last + 1
  returning last into v_seq;

  loop
    v_code := app.random_code(16);
    exit when not exists (select 1 from public.certificates where verification_code = v_code);
  end loop;

  insert into public.certificates (number, verification_code, enrollment_id, user_id, course_id, course_version_id,
    holder_name, course_title, course_code, instructor_name, company_name, company_id, score, duration_minutes,
    issued_at, expires_at, signer_name, signer_title)
  values (
    format('%s-%s-%s', coalesce(nullif(v_cfg ->> 'prefix', ''), 'TMC'), v_year, lpad(v_seq::text, 6, '0')),
    v_code, e.id, e.user_id, e.course_id, e.course_version_id,
    p.full_name, c.title, c.code,
    (select pr.full_name from public.course_instructors ci join public.profiles pr on pr.id = ci.user_id
       where ci.course_id = c.id order by (ci.role = 'lead') desc, ci.added_at limit 1),
    (select name from public.companies where id = p.company_id), p.company_id,
    e.final_score, c.estimated_minutes,
    coalesce(e.passed_at, e.content_completed_at, now()), e.valid_until,
    nullif(v_cfg ->> 'signer_name', ''), nullif(v_cfg ->> 'signer_title', ''))
  returning id into v_id;

  perform app.notify(e.user_id, 'certificate_ready', format('Tu constancia de «%s» está lista', c.title),
    'Puedes descargarla en «Certificados».', '/certificados', 'certificate', v_id, 'certificate:' || v_id);
  return v_id;
end $$;

create or replace function app.on_enrollment_completed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.progress_status = 'completed' and old.progress_status is distinct from 'completed' then
    perform app.issue_certificate(new.id);
  end if;
  return null;
end $$;
create trigger enrollments_issue_certificate after update of progress_status, result on public.enrollments
  for each row execute function app.on_enrollment_completed();

-- Revocar (con motivo; queda en la bitácora). Una constancia revocada se muestra como tal al verificarla.
create or replace function public.revoke_certificate(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare k public.certificates;
begin
  select * into k from public.certificates where id = p_id for update;
  if not found then perform app.fail('NOT_FOUND', 'certificate'); end if;
  if not app.can_user('certificates.revoke', k.user_id) then perform app.fail('FORBIDDEN', 'certificates.revoke'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', '{"reason":"required"}'); end if;
  if k.status = 'revoked' then return; end if;
  update public.certificates set status = 'revoked', revoked_at = now(), revoked_by = app.actor_id(), revoked_reason = trim(p_reason)
  where id = p_id;
end $$;
grant execute on function public.revoke_certificate(uuid, text) to authenticated;

-- Verificación pública (sin sesión). Solo datos mínimos: ni correo ni número de empleado.
create or replace function public.verify_certificate(p_code text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'number', k.number, 'holder_name', k.holder_name, 'course_title', k.course_title, 'company_name', k.company_name,
    'issued_at', k.issued_at, 'expires_at', k.expires_at, 'score', k.score,
    'status', case when k.status = 'revoked' then 'revoked' when k.expires_at is not null and k.expires_at < now() then 'expired' else 'valid' end,
    'revoked_at', k.revoked_at)
  from public.certificates k
  where k.verification_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;
revoke execute on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

-- Guarda el PDF generado (solo el servidor, una vez).
create or replace function public.attach_certificate_pdf(p_id uuid, p_file uuid, p_sha256 text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.certificates set pdf_file_id = p_file, pdf_sha256 = p_sha256 where id = p_id and pdf_file_id is null;
  return found;
end $$;
revoke execute on function public.attach_certificate_pdf(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.attach_certificate_pdf(uuid, uuid, text) to service_role;

-- Constancias de lo que ya estaba terminado antes de esta fase.
select app.issue_certificate(e.id) from public.enrollments e
where e.progress_status = 'completed' and e.state in ('active', 'superseded') order by coalesce(e.passed_at, e.content_completed_at, e.updated_at);
