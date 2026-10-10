-- ============================================================================
-- 0022 · Firma de constancias por empresa
-- settings 'certificates' con company_id = la empresa de la persona sustituye a la configuración global
-- (nombre y cargo de quien firma). Sin registro propio, la empresa usa la firma global.
-- ============================================================================

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
  -- Firma por empresa: lo que la empresa defina sustituye a lo global (p. ej. ATPVA firma su Capital Humano).
  v_cfg := v_cfg || coalesce((select s.value from public.settings s where s.key = 'certificates' and s.company_id = p.company_id), '{}');

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
