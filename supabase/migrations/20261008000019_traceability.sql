-- ============================================================================
-- 0019 · Trazabilidad ISO (Fase 9, §59)
-- Responde con datos: quién creó/modificó un curso y cuándo, qué versión tomó cada persona, qué examen presentó,
-- qué respondió, quién calificó, qué calificación recibió, cuándo aprobó y qué constancia obtuvo;
-- y demuestra que la bitácora no se alteró (cadena de hash).
-- ============================================================================

-- Integridad de la bitácora (para la pantalla de Auditoría).
create or replace function public.verify_audit_chain()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_broken bigint;
begin
  if not app.can_any('audit.read') then perform app.fail('FORBIDDEN', 'audit.read'); end if;
  v_broken := audit.verify_chain();
  return jsonb_build_object(
    'ok', v_broken is null, 'broken_at', v_broken,
    'sealed', (select count(*) from audit.audit_logs where hash is not null),
    'pending', (select count(*) from audit.audit_logs where hash is null),
    'first_at', (select min(occurred_at) from audit.audit_logs),
    'checked_at', now());
end $$;
grant execute on function public.verify_audit_chain() to authenticated;

-- ---------------------------------------------------------------------------
-- Curso: versiones (quién creó, publicó, qué cambió, cuántos la tomaron) y bitácora completa
-- ---------------------------------------------------------------------------
create or replace function public.course_versions_trace(p_course uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not (app.can_manage_course(p_course, 'courses.read') or app.can_any('audit.read')) then perform app.fail('FORBIDDEN', 'courses.read'); end if;
  select jsonb_build_object(
    'course', (select jsonb_build_object('code', c.code, 'title', c.title, 'created_at', c.created_at, 'created_by', cb.full_name)
               from public.courses c left join public.profiles cb on cb.id = c.created_by where c.id = p_course),
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', cv.id, 'number', cv.version_number, 'status', cv.status, 'change_summary', cv.change_summary,
        'requires_retraining', cv.requires_retraining, 'passing_score', cv.passing_score,
        'created_at', cv.created_at, 'created_by', pc.full_name, 'published_at', cv.published_at, 'published_by', pp.full_name,
        'retired_at', cv.retired_at,
        'took', (select count(*) from public.enrollments e where e.course_version_id = cv.id and e.state <> 'cancelled'),
        'passed', (select count(*) from public.enrollments e where e.course_version_id = cv.id and e.progress_status = 'completed'))
        order by cv.version_number desc)
      from public.course_versions cv
      left join public.profiles pc on pc.id = cv.created_by left join public.profiles pp on pp.id = cv.published_by
      where cv.course_id = p_course), '[]'))
  into v;
  return v;
end $$;
grant execute on function public.course_versions_trace(uuid) to authenticated;

-- Todos los cambios del curso y de sus piezas (versiones, módulos, lecciones, contenidos, exámenes, instructores).
create or replace function public.course_history(p_course uuid, p_limit int default 100)
returns table (id bigint, occurred_at timestamptz, actor_id uuid, actor_name text, actor_roles text[], action text,
               entity_type text, entity_id uuid, company_id uuid, old_data jsonb, new_data jsonb, ip text, user_agent text, sealed boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare ids uuid[];
begin
  if not (app.can_manage_course(p_course, 'courses.update') or app.can_any('audit.read')) then perform app.fail('FORBIDDEN', 'audit.read'); end if;
  select array_agg(s.x) into ids from (
    select p_course x
    union all select cv.id from public.course_versions cv where cv.course_id = p_course
    union all select m.id from public.course_modules m join public.course_versions v on v.id = m.course_version_id where v.course_id = p_course
    union all select l.id from public.lessons l join public.course_modules m on m.id = l.module_id join public.course_versions v on v.id = m.course_version_id where v.course_id = p_course
    union all select lc.id from public.lesson_contents lc join public.lessons l on l.id = lc.lesson_id join public.course_modules m on m.id = l.module_id
                join public.course_versions v on v.id = m.course_version_id where v.course_id = p_course
    union all select x.id from public.exams x join public.course_versions v on v.id = x.course_version_id where v.course_id = p_course
    union all select ei.id from public.exam_items ei join public.exams x on x.id = ei.exam_id join public.course_versions v on v.id = x.course_version_id where v.course_id = p_course
    union all select a.id from public.assignments a where a.course_id = p_course
  ) s;
  return query
    select a.id, a.occurred_at, a.actor_id, ap.full_name, a.actor_roles, a.action, a.entity_type, a.entity_id,
           a.company_id, a.old_data, a.new_data, a.ip, a.user_agent, a.hash is not null
    from audit.audit_logs a left join public.profiles ap on ap.id = a.actor_id
    where a.entity_id = any (ids)
       or (a.entity_type in ('course_instructor', 'course_prerequisite')
           and coalesce(a.new_data ->> 'course_id', a.old_data ->> 'course_id') = p_course::text)
    order by a.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;
grant execute on function public.course_history(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Trazabilidad completa de una persona en un curso (una inscripción)
-- Las claves de respuesta solo se incluyen para quien califica o audita.
-- ---------------------------------------------------------------------------
create or replace function public.enrollment_trace(p_enrollment uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  e public.enrollments;
  v_keys boolean;
  v jsonb;
begin
  select * into e from public.enrollments where id = p_enrollment;
  if not found then perform app.fail('NOT_FOUND', 'enrollment'); end if;
  if not (app.can_user('progress.read', e.user_id) or app.can_user('audit.read', e.user_id) or app.can_user('grading.grade', e.user_id)) then
    perform app.fail('FORBIDDEN', 'progress.read');
  end if;
  v_keys := app.can_user('grading.grade', e.user_id) or app.can_user('audit.read', e.user_id);

  select jsonb_build_object(
    'person', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'employee_number', p.employee_number, 'company', c.name, 'department', d.name, 'position', po.name)
               from public.profiles p join public.companies c on c.id = p.company_id left join public.departments d on d.id = p.department_id
               left join public.positions po on po.id = p.position_id where p.id = e.user_id),
    'course', (select jsonb_build_object('id', c.id, 'code', c.code, 'title', c.title, 'created_at', c.created_at, 'created_by', cb.full_name,
                 'last_change_at', (select max(occurred_at) from audit.audit_logs a where a.entity_id = c.id and a.action like 'course.%'))
               from public.courses c left join public.profiles cb on cb.id = c.created_by where c.id = e.course_id),
    'version', (select jsonb_build_object('number', cv.version_number, 'status', cv.status, 'published_at', cv.published_at, 'published_by', pp.full_name,
                  'change_summary', cv.change_summary, 'passing_score', cv.passing_score, 'min_completion_pct', cv.min_completion_pct)
                from public.course_versions cv left join public.profiles pp on pp.id = cv.published_by where cv.id = e.course_version_id),
    'enrollment', jsonb_build_object('id', e.id, 'cycle', e.cycle, 'state', e.state, 'requirement', e.requirement, 'progress_status', e.progress_status,
        'result', e.result, 'progress_pct', e.progress_pct, 'final_score', e.final_score, 'assigned_at', e.assigned_at, 'due_at', e.due_at,
        'started_at', e.started_at, 'content_completed_at', e.content_completed_at, 'passed_at', e.passed_at, 'failed_at', e.failed_at,
        'valid_until', e.valid_until, 'total_seconds', e.total_seconds, 'cancelled_at', e.cancelled_at, 'cancel_reason', e.cancel_reason,
        'assigned_by', (select pb.full_name from public.assignments a join public.profiles pb on pb.id = a.created_by where a.id = e.assignment_id),
        'assignment_mode', (select a.mode from public.assignments a where a.id = e.assignment_id)),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('type', x.type, 'reason', x.reason, 'value', x.value, 'granted_by', g.full_name, 'created_at', x.created_at) order by x.created_at)
        from public.enrollment_exceptions x left join public.profiles g on g.id = x.granted_by where x.enrollment_id = e.id), '[]'),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('title', l.title, 'status', coalesce(lp.status::text, 'not_started'), 'first_viewed_at', lp.first_viewed_at,
          'completed_at', lp.completed_at, 'seconds', coalesce(lp.seconds_spent, 0), 'required', o.is_required) order by o.ord)
        from app.ordered_lessons(e.course_version_id) o join public.lessons l on l.id = o.lesson_id
        left join public.lesson_progress lp on lp.lesson_id = l.id and lp.enrollment_id = e.id), '[]'),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'exam', x.title, 'number', a.attempt_number, 'status', a.status, 'started_at', a.started_at, 'submitted_at', a.submitted_at,
          'submitted_by', a.submitted_by, 'duration_seconds', a.duration_seconds, 'score_pct', a.score_pct, 'passed', a.passed,
          'max_points', a.max_points, 'score_points', a.score_points, 'graded_at', a.graded_at, 'void_reason', a.void_reason,
          'voided_by', (select full_name from public.profiles where id = a.voided_by), 'client_ip', a.client_ip,
          'events', coalesce((select jsonb_agg(jsonb_build_object('type', ev.type, 'at', ev.at) order by ev.at) from public.attempt_events ev where ev.attempt_id = a.id), '[]'),
          'questions', coalesce((select jsonb_agg(jsonb_build_object(
                'position', aq.position, 'points', aq.points, 'snapshot', aq.snapshot,
                'key', case when v_keys then (select k.key from app.attempt_question_keys k where k.attempt_question_id = aq.id) end,
                'response', an.response, 'auto_points', an.auto_points, 'final_points', an.final_points, 'is_correct', an.is_correct,
                'needs_manual', an.needs_manual, 'graded_at', an.graded_at, 'graded_by', (select full_name from public.profiles where id = an.graded_by),
                'grades', coalesce((select jsonb_agg(jsonb_build_object('grader', gp.full_name, 'score_pct', mg.score_pct, 'points', mg.points, 'feedback', mg.feedback,
                                       'is_override', mg.is_override, 'created_at', mg.created_at) order by mg.created_at)
                                    from public.manual_grades mg join public.profiles gp on gp.id = mg.grader_id where mg.answer_id = an.id), '[]'))
              order by aq.position)
            from public.attempt_questions aq left join public.attempt_answers an on an.attempt_question_id = aq.id where aq.attempt_id = a.id), '[]'))
          order by a.started_at)
        from public.exam_attempts a join public.exams x on x.id = a.exam_id where a.enrollment_id = e.id), '[]'),
    'certificate', (select jsonb_build_object('number', k.number, 'verification_code', k.verification_code, 'issued_at', k.issued_at, 'expires_at', k.expires_at,
                      'score', k.score, 'status', k.status, 'pdf_sha256', k.pdf_sha256, 'revoked_at', k.revoked_at, 'revoked_reason', k.revoked_reason,
                      'revoked_by', (select full_name from public.profiles where id = k.revoked_by))
                    from public.certificates k where k.enrollment_id = e.id),
    'includes_keys', v_keys,
    'generated_at', now())
  into v;
  return v;
end $$;
grant execute on function public.enrollment_trace(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Historial del empleado (§6): todos sus ciclos, con la versión que tomó (§31: "v1 — Aprobado")
-- ---------------------------------------------------------------------------
create or replace function public.my_history()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'course', c.title, 'code', c.code, 'version', cv.version_number, 'cycle', e.cycle, 'state', e.state,
      'progress_status', e.progress_status, 'result', e.result, 'progress_pct', e.progress_pct, 'final_score', e.final_score,
      'assigned_at', e.assigned_at, 'due_at', e.due_at, 'started_at', e.started_at,
      'finished_at', coalesce(e.passed_at, e.failed_at, e.content_completed_at),
      'attempts', (select count(*) from public.exam_attempts a where a.enrollment_id = e.id and a.status not in ('in_progress', 'voided')),
      'certificate_id', (select k.id from public.certificates k where k.enrollment_id = e.id and k.status = 'valid'))
    order by e.assigned_at desc), '[]')
  from public.enrollments e
  join public.courses c on c.id = e.course_id
  left join public.course_versions cv on cv.id = e.course_version_id
  where e.user_id = (select auth.uid()) and e.state <> 'cancelled'
$$;
grant execute on function public.my_history() to authenticated;
