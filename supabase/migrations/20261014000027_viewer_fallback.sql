-- Visor de presentaciones en celulares viejos: si el visor no logra abrir el documento, el teléfono avisa
-- (evento 'viewer_failed') y una lección con regla «Ver todas las páginas» cuenta como vista, para que la persona
-- pueda seguir con el examen. Queda registrado en la bitácora con el navegador.

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
  if p_event not in ('open', 'heartbeat', 'viewer_failed') then perform app.fail('VALIDATION', 'event'); end if;
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

  -- El visor no pudo abrir el documento en el teléfono (navegador muy viejo, sin memoria…): la lección cuenta como
  -- vista para no dejar a la persona sin examen. Queda en la bitácora con el navegador, para revisarlo.
  if p_event = 'viewer_failed' and lp.status <> 'completed' and l.completion_rule = 'all_pages' then
    lp.status := 'completed';
    lp.completed_at := now();
    perform app.log('lesson.viewer_failed', 'lesson', p_lesson, null, null,
      jsonb_build_object('enrollment_id', e.id, 'user_agent', left(app.request_header('user-agent'), 300)));
  end if;

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
