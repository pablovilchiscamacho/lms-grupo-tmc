-- ============================================================================
-- 0018 · Correo (Fase 8)
-- Cada aviso de la plataforma (notifications) puede salir también por correo. Todo vive en la base:
--   aviso → email_outbox (con dedupe) → pg_cron cada 2 min → pg_net → API de Resend (en lotes de hasta 100)
--   → la respuesta se concilia en la siguiente vuelta (enviado, reintento con espera o fallido).
-- La clave de Resend se guarda cifrada en Supabase Vault ('resend_api_key'), nunca en el código ni en Vercel.
-- Mientras el correo esté desactivado (settings 'email'.enabled = false) no se encola nada.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- Tipos de aviso nuevos: evaluación pendiente (para quien califica) y resumen semanal del jefe.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'course_assigned', 'due_soon', 'overdue', 'course_passed', 'course_failed', 'course_completed',
  'attempt_graded', 'retraining', 'renewal', 'extension', 'extra_attempts', 'cancelled', 'certificate_ready',
  'review_pending', 'team_overdue'));

insert into public.settings (key, value) values
  ('email', jsonb_build_object(
     'enabled', false,
     'from', 'Capacitación Grupo TMC <capacitacion@example.com>',
     'reply_to', null,
     'app_url', 'https://lms-grupo-tmc.vercel.app',
     'types', jsonb_build_object(
       'course_assigned', true, 'due_soon', true, 'overdue', true, 'course_passed', true, 'course_failed', true,
       'course_completed', false, 'attempt_graded', true, 'retraining', true, 'renewal', true, 'extension', true,
       'extra_attempts', true, 'cancelled', false, 'certificate_ready', true, 'review_pending', true, 'team_overdue', true))),
  ('reminders', '{"days_before": [7, 3, 1], "overdue": true, "overdue_every_days": 7, "manager_digest": true}')
on conflict do nothing;

create table public.email_outbox (
  id              uuid primary key default gen_random_uuid(),
  to_email        text not null check (to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id         uuid references public.profiles (id),
  template_key    text not null,
  subject         text not null,
  payload         jsonb not null default '{}',
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts        int not null default 0,
  last_error      text,
  request_id      bigint,
  batch_index     int,
  scheduled_at    timestamptz not null default now(),
  sent_at         timestamptz,
  provider_id     text,
  dedupe_key      text unique,
  created_at      timestamptz not null default now()
);
create index email_outbox_pending_idx on public.email_outbox (scheduled_at) where status = 'pending';
create index email_outbox_sending_idx on public.email_outbox (request_id) where status = 'sending';
create index email_outbox_created_idx on public.email_outbox (created_at desc);
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
grant select on public.email_outbox to authenticated;
create policy email_outbox_select on public.email_outbox for select to authenticated using (app.can_group('notifications.manage'));

-- ---------------------------------------------------------------------------
-- Plantilla (HTML sencillo con estilos en línea: se ve bien en Outlook y Gmail)
-- ---------------------------------------------------------------------------
create or replace function app.html_escape(p text)
returns text language sql immutable set search_path = ''
as $$ select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

create or replace function app.email_html(p_name text, p_title text, p_body text, p_url text, p_button text default 'Abrir la plataforma')
returns text language sql immutable set search_path = ''
as $$
  select format($html$<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#0f2a4a;padding:18px 24px;color:#ffffff;font-size:15px;font-weight:bold">Grupo TMC · Capacitación</td></tr>
<tr><td style="padding:28px 24px 8px">
<p style="margin:0 0 6px;font-size:14px;color:#64748b">Hola%s,</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f2a4a">%s</h1>
%s
<p style="margin:24px 0 8px"><a href="%s" style="display:inline-block;background:#24508d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;font-size:14px">%s</a></p>
</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9">Aviso automático de la plataforma de capacitación de Grupo TMC. No respondas a este correo; si tienes dudas, acude con tu jefe o con el área de Capacitación.</td></tr>
</table></td></tr></table></body></html>$html$,
    case when coalesce(p_name, '') = '' then '' else ' ' || app.html_escape(p_name) end,
    app.html_escape(p_title),
    case when coalesce(p_body, '') = '' then '' else '<p style="margin:0;font-size:15px;line-height:1.5;color:#334155">' || replace(app.html_escape(p_body), E'\n', '<br>') || '</p>' end,
    app.html_escape(p_url), app.html_escape(p_button))
$$;

-- Encola un correo (idempotente por dedupe_key). Devuelve el id o null si ya existía.
create or replace function app.enqueue_email(p_to text, p_user uuid, p_template text, p_subject text, p_payload jsonb, p_dedupe text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  insert into public.email_outbox (to_email, user_id, template_key, subject, payload, dedupe_key)
  values (lower(trim(p_to)), p_user, p_template, left(p_subject, 200), coalesce(p_payload, '{}'), p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v;
  return v;
end $$;

-- Cada aviso nuevo sale por correo si el correo está activo, ese tipo está encendido y la persona tiene correo real.
create or replace function app.on_notification_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := coalesce(app.setting('email'), '{}');
  p public.profiles;
begin
  if not coalesce((cfg ->> 'enabled')::boolean, false) or not coalesce((cfg -> 'types' ->> new.type)::boolean, false) then return null; end if;
  select * into p from public.profiles where id = new.user_id;
  if p.status <> 'active' or not p.has_real_email or p.email is null then return null; end if;
  perform app.enqueue_email(p.email, p.id, new.type, new.title,
    jsonb_build_object('name', p.first_name, 'title', new.title, 'body', new.body, 'link', new.link), 'n:' || new.id);
  return null;
end $$;
create trigger notifications_email after insert on public.notifications for each row execute function app.on_notification_email();

-- ---------------------------------------------------------------------------
-- Envío: conciliación de respuestas + nuevo lote. Corre cada 2 minutos.
-- ---------------------------------------------------------------------------
create or replace function app.dispatch_emails()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := coalesce(app.setting('email'), '{}');
  v_key text;
  v_url text := coalesce(cfg ->> 'app_url', '');
  r record;
  resp record;
  v_ids uuid[];
  v_batch jsonb := '[]';
  v_req bigint;
  v_sent int := 0; v_failed int := 0; v_queued int := 0; n int;
begin
  -- 1) Conciliar lo que se mandó en vueltas anteriores.
  for r in select distinct request_id from public.email_outbox where status = 'sending' and request_id is not null loop
    select * into resp from net._http_response where id = r.request_id;
    if not found then
      -- Sin respuesta después de 10 min: se reintenta.
      update public.email_outbox set status = 'pending', request_id = null, batch_index = null, last_error = 'Sin respuesta del proveedor'
      where request_id = r.request_id and status = 'sending' and scheduled_at < now() - interval '10 minutes';
      continue;
    end if;
    if resp.status_code between 200 and 299 then
      update public.email_outbox o set status = 'sent', sent_at = now(), last_error = null,
        provider_id = coalesce((resp.content::jsonb -> 'data' -> o.batch_index ->> 'id'), resp.content::jsonb ->> 'id')
      where o.request_id = r.request_id and o.status = 'sending';
      get diagnostics n = row_count; v_sent := v_sent + n;
    else
      -- 429 o 5xx: esperar y reintentar el lote. 4xx: reintentar uno por uno (puede haber una dirección inválida).
      update public.email_outbox set
        status = case when attempts >= 4 then 'failed' else 'pending' end,
        last_error = left(coalesce(resp.error_msg, '') || ' ' || coalesce(resp.status_code::text, '') || ' ' || coalesce(resp.content, ''), 500),
        scheduled_at = now() + make_interval(mins => power(2, attempts)::int * 2),
        request_id = null, batch_index = null
      where request_id = r.request_id and status = 'sending';
      get diagnostics n = row_count; v_failed := v_failed + n;
    end if;
  end loop;

  -- 2) Nuevo envío (solo con clave). Los que ya fallaron una vez van solos; el resto en un lote de hasta 100.
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  if v_key is null or v_key = '' then
    return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'queued', 0, 'note', 'sin clave de Resend');
  end if;

  select array_agg(id order by created_at) into v_ids from (
    select id, created_at from public.email_outbox
    where status = 'pending' and scheduled_at <= now()
    order by (attempts > 0), created_at limit 100 for update skip locked) x;
  if v_ids is null then return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'queued', 0); end if;

  -- Si el primero ya falló antes, se manda solo ese (aislar direcciones problemáticas).
  if (select attempts from public.email_outbox where id = v_ids[1]) > 0 then v_ids := v_ids[1:1]; end if;

  for r in select o.*, ord from unnest(v_ids) with ordinality as u(id, ord) join public.email_outbox o on o.id = u.id order by ord loop
    v_batch := v_batch || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'from', cfg ->> 'from', 'to', jsonb_build_array(r.to_email), 'reply_to', cfg ->> 'reply_to', 'subject', r.subject,
      'html', app.email_html(r.payload ->> 'name', coalesce(r.payload ->> 'title', r.subject), r.payload ->> 'body',
                             v_url || coalesce(r.payload ->> 'link', '/'), coalesce(r.payload ->> 'button', 'Abrir la plataforma')),
      'headers', jsonb_build_object('X-Entity-Ref-ID', r.id::text))));
  end loop;

  v_req := net.http_post(
    url := 'https://api.resend.com/emails/batch',
    body := v_batch,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);

  update public.email_outbox o set status = 'sending', request_id = v_req, attempts = o.attempts + 1, scheduled_at = now(),
    batch_index = array_position(v_ids, o.id) - 1
  where o.id = any (v_ids);
  v_queued := array_length(v_ids, 1);
  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'queued', v_queued, 'request_id', v_req);
end $$;
revoke execute on function app.dispatch_emails() from public;

-- Correos de más de 3 días que nunca salieron (por ejemplo, sin clave) se cancelan para no mandar avisos viejos.
create or replace function app.expire_stale_emails()
returns int language sql security definer set search_path = ''
as $$
  with x as (update public.email_outbox set status = 'cancelled', last_error = coalesce(last_error, 'Venció sin enviarse')
             where status = 'pending' and created_at < now() - interval '3 days' returning 1)
  select count(*)::int from x
$$;

-- ---------------------------------------------------------------------------
-- Evaluación pendiente: avisa a los instructores del curso (o, si no hay, a quien califica en todo el grupo).
-- ---------------------------------------------------------------------------
create or replace function app.on_attempt_pending_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_course uuid; v_title text; v_name text; u uuid; n int := 0;
begin
  if new.status = 'pending_review' and old.status is distinct from 'pending_review' then
    select e.course_id, c.title into v_course, v_title from public.enrollments e join public.courses c on c.id = e.course_id where e.id = new.enrollment_id;
    select full_name into v_name from public.profiles where id = new.user_id;
    for u in select ci.user_id from public.course_instructors ci join public.profiles p on p.id = ci.user_id
             where ci.course_id = v_course and p.status = 'active' and ci.user_id <> new.user_id loop
      perform app.notify(u, 'review_pending', format('Examen por calificar: «%s»', v_title), format('%s entregó un examen con preguntas abiertas.', v_name),
                         '/admin/calificaciones', 'exam_attempt', new.id, 'review:' || new.id || ':' || u);
      n := n + 1;
    end loop;
    if n = 0 then
      for u in select distinct ur.user_id from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
               join public.profiles p on p.id = ur.user_id
               where rp.permission_key = 'grading.grade' and ur.scope_type = 'group' and ur.revoked_at is null
                 and (ur.expires_at is null or ur.expires_at > now()) and p.status = 'active' and ur.user_id <> new.user_id loop
        perform app.notify(u, 'review_pending', format('Examen por calificar: «%s»', v_title), format('%s entregó un examen con preguntas abiertas.', v_name),
                           '/admin/calificaciones', 'exam_attempt', new.id, 'review:' || new.id || ':' || u);
      end loop;
    end if;
  end if;
  return null;
end $$;
create trigger exam_attempts_notify_review after update of status on public.exam_attempts for each row execute function app.on_attempt_pending_review();

-- ---------------------------------------------------------------------------
-- Recordatorios configurables y resumen semanal para jefes (reemplaza el job diario de la 0013)
-- ---------------------------------------------------------------------------
drop function app.daily_assignments_job();
create function app.daily_assignments_job(p_force_digest boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := coalesce(app.setting('reminders'), '{}');
  v_before int[] := coalesce((select array_agg(x::int) from jsonb_array_elements_text(cfg -> 'days_before') x), '{7,3,1}');
  v_overdue boolean := coalesce((cfg ->> 'overdue')::boolean, true);
  v_every int := greatest(coalesce((cfg ->> 'overdue_every_days')::int, 0), 0);
  r record;
  v_renewed int := 0; v_notified int := 0; v_digests int := 0;
  v_days int;
  v_tz text;
begin
  for r in select e.id, e.user_id, e.valid_until from public.enrollments e join public.courses c on c.id = e.course_id
           where e.state = 'active' and e.valid_until is not null and e.valid_until - interval '30 days' <= now() and c.status = 'published' loop
    if app.supersede_and_renew(r.id, r.valid_until) is not null then v_renewed := v_renewed + 1; end if;
  end loop;

  for r in select e.id, e.user_id, e.due_at, c.title from public.enrollments e join public.courses c on c.id = e.course_id
           where e.state = 'active' and e.progress_status <> 'completed' and e.result <> 'failed' and e.due_at is not null
             and e.due_at < now() + make_interval(days => coalesce((select max(x) from unnest(v_before) x), 7) + 1) loop
    v_tz := app.user_tz(r.user_id);
    v_days := (r.due_at at time zone v_tz)::date - app.local_today(v_tz);
    if v_days = any (v_before) then
      perform app.notify(r.user_id, 'due_soon', case when v_days = 1 then format('«%s» vence mañana', r.title) when v_days = 0 then format('«%s» vence hoy', r.title)
                         else format('«%s» vence en %s días', r.title, v_days) end,
                         null, '/cursos/' || r.id, 'enrollment', r.id, 'due:' || r.id || ':' || v_days);
      v_notified := v_notified + 1;
    elsif v_days < 0 and v_overdue and (v_days = -1 or (v_every > 0 and (-v_days - 1) % v_every = 0)) then
      perform app.notify(r.user_id, 'overdue', format('«%s» está vencido', r.title), 'Termínalo lo antes posible o habla con tu jefe.',
                         '/cursos/' || r.id, 'enrollment', r.id, 'overdue:' || r.id || ':' || (-v_days));
      v_notified := v_notified + 1;
    end if;
  end loop;

  -- Los lunes (hora de la empresa), cada jefe con permiso de seguimiento recibe el resumen de su equipo atrasado.
  if coalesce((cfg ->> 'manager_digest')::boolean, true) and (p_force_digest or extract(isodow from (now() at time zone 'America/Mexico_City')) = 1) then
    for r in
      select h.ancestor_id as manager, count(distinct e.user_id) people, count(*) courses,
             string_agg(distinct p.full_name, ', ') filter (where p.full_name is not null) names
      from public.enrollments e
      join public.profiles p on p.id = e.user_id and p.status = 'active'
      join public.profile_hierarchy h on h.descendant_id = e.user_id and h.depth > 0
      join public.profiles m on m.id = h.ancestor_id and m.status = 'active'
      where e.state = 'active' and e.requirement = 'mandatory' and e.progress_status <> 'completed' and e.result <> 'failed' and e.due_at < now()
        and exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                    where ur.user_id = h.ancestor_id and rp.permission_key = 'progress.read' and ur.revoked_at is null
                      and (ur.expires_at is null or ur.expires_at > now()))
      group by h.ancestor_id
    loop
      perform app.notify(r.manager, 'team_overdue',
        format('%s %s de tu equipo %s cursos vencidos', r.people, case when r.people = 1 then 'persona' else 'personas' end, case when r.people = 1 then 'tiene' else 'tienen' end),
        format('%s curso%s vencido%s. %s', r.courses, case when r.courses = 1 then '' else 's' end, case when r.courses = 1 then '' else 's' end, left(r.names, 300)),
        '/admin/cumplimiento?estado=vencidos', 'profile', r.manager, 'team_overdue:' || r.manager || ':' || to_char(now() at time zone 'America/Mexico_City', 'IYYY-IW'));
      v_digests := v_digests + 1;
    end loop;
  end if;
  return jsonb_build_object('renewed', v_renewed, 'notified', v_notified, 'digests', v_digests);
end $$;

-- ---------------------------------------------------------------------------
-- Administración (notifications.manage)
-- ---------------------------------------------------------------------------
create or replace function public.email_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.can_any('notifications.manage') then perform app.fail('FORBIDDEN', 'notifications.manage'); end if;
  return jsonb_build_object(
    'email', app.setting('email'), 'reminders', app.setting('reminders'),
    'has_key', exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key' and coalesce(decrypted_secret, '') <> ''),
    'pending', (select count(*) from public.email_outbox where status in ('pending', 'sending')),
    'sent_7d', (select count(*) from public.email_outbox where status = 'sent' and sent_at > now() - interval '7 days'),
    'failed_7d', (select count(*) from public.email_outbox where status = 'failed' and created_at > now() - interval '7 days'));
end $$;
grant execute on function public.email_status() to authenticated;

create or replace function public.save_notification_settings(p_email jsonb, p_reminders jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare cur jsonb := coalesce(app.setting('email'), '{}'); v_days jsonb;
begin
  if not app.can_group('notifications.manage') then perform app.fail('FORBIDDEN', 'notifications.manage'); end if;
  if p_email is not null then
    if p_email ? 'from' and (p_email ->> 'from') !~ '^[^<>]{1,80}<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$' and (p_email ->> 'from') !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then
      perform app.fail('VALIDATION', '{"from":"invalid"}');
    end if;
    update public.settings set value = cur || (p_email - 'app_url') || jsonb_build_object('types', coalesce(cur -> 'types', '{}') || coalesce(p_email -> 'types', '{}')),
      updated_by = app.actor_id(), updated_at = now()
    where key = 'email' and company_id is null;
  end if;
  if p_reminders is not null then
    v_days := coalesce(p_reminders -> 'days_before', '[]');
    if jsonb_typeof(v_days) <> 'array' or jsonb_array_length(v_days) > 6
       or exists (select 1 from jsonb_array_elements_text(v_days) x where x !~ '^\d{1,2}$' or x::int > 60) then
      perform app.fail('VALIDATION', '{"days_before":"invalid"}');
    end if;
    update public.settings set value = value || jsonb_build_object(
        'days_before', (select coalesce(jsonb_agg(d order by d desc), '[]') from (select distinct x::int d from jsonb_array_elements_text(v_days) x) s),
        'overdue', coalesce((p_reminders ->> 'overdue')::boolean, true),
        'overdue_every_days', least(greatest(coalesce((p_reminders ->> 'overdue_every_days')::int, 7), 0), 60),
        'manager_digest', coalesce((p_reminders ->> 'manager_digest')::boolean, true)),
      updated_by = app.actor_id(), updated_at = now()
    where key = 'reminders' and company_id is null;
  end if;
  perform app.log('settings.notifications_updated', 'settings', null, null, null, jsonb_build_object('email', p_email, 'reminders', p_reminders));
end $$;
grant execute on function public.save_notification_settings(jsonb, jsonb) to authenticated;

-- Correo de prueba (funciona aunque el correo esté desactivado, para validar la configuración).
create or replace function public.send_test_email(p_to text)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if not app.can_group('notifications.manage') then perform app.fail('FORBIDDEN', 'notifications.manage'); end if;
  if coalesce(p_to, '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform app.fail('VALIDATION', '{"to":"invalid"}'); end if;
  if not public.hit_rate_limit('test-email:' || app.actor_id(), 5, 3600) then perform app.fail('RATE_LIMITED'); end if;
  return app.enqueue_email(p_to, null, 'test', 'Prueba de correo · Capacitación Grupo TMC',
    jsonb_build_object('title', 'El correo de la plataforma funciona', 'body', 'Si recibiste este mensaje, los avisos por correo están bien configurados.', 'link', '/'),
    'test:' || gen_random_uuid());
end $$;
grant execute on function public.send_test_email(text) to authenticated;

-- Jobs
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('email-dispatch', '*/2 * * * *', 'select app.dispatch_emails()');
    perform cron.schedule('email-expire', '30 3 * * *', 'select app.expire_stale_emails()');
  end if;
end $$;
