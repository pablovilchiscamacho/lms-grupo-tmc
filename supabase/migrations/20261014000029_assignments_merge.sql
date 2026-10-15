-- Asignaciones «Personas específicas» sin cuadros repetidos (petición de Capital Humano de ATPVA):
--   1) Al asignar un curso a personas específicas, si ya hay una asignación activa de ese curso a personas
--      específicas con las mismas condiciones (obligatoriedad, fechas, acceso tardío), las personas se SUMAN a esa
--      asignación en lugar de crear otra.
--   2) add_to_assignment: «Agregar personas» a una asignación de personas específicas que ya existe.

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
  v_merged boolean := false;
  v_req public.requirement_level; v_start timestamptz; v_due_at timestamptz; v_due_days int;
  v_exp_at timestamptz; v_exp_days int; v_late boolean;
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

  v_req := coalesce(nullif(p ->> 'requirement', ''), v_course.default_requirement::text)::public.requirement_level;
  v_start := nullif(p ->> 'start_at', '')::timestamptz;
  v_due_at := case when nullif(p ->> 'due_date', '') is not null then app.end_of_day((p ->> 'due_date')::date, v_tz) end;
  v_due_days := nullif(p ->> 'due_in_days', '')::int;
  v_exp_at := case when nullif(p ->> 'expires_date', '') is not null then app.end_of_day((p ->> 'expires_date')::date, v_tz) end;
  v_exp_days := nullif(p ->> 'expires_in_days', '')::int;
  v_late := coalesce((p ->> 'allow_late_access')::boolean, true);

  if v_mode = 'direct' then
    select * into a from public.assignments x
     where x.course_id = v_course.id and x.mode = 'direct' and x.is_active and x.requirement = v_req
       and x.start_at is not distinct from v_start and x.due_at is not distinct from v_due_at
       and x.due_in_days is not distinct from v_due_days and x.expires_at is not distinct from v_exp_at
       and x.expires_in_days is not distinct from v_exp_days and x.allow_late_access = v_late
     order by x.created_at limit 1;
    v_merged := found;
  end if;

  if not v_merged then
    insert into public.assignments (course_id, mode, company_id, branch_id, department_id, position_id, user_group_id, include_future_users,
                                    requirement, start_at, due_at, due_in_days, expires_at, expires_in_days, allow_late_access, notes, created_by)
    values (v_course.id, v_mode,
            case when v_mode = 'rule' then nullif(p ->> 'company_id', '')::uuid end, case when v_mode = 'rule' then nullif(p ->> 'branch_id', '')::uuid end,
            case when v_mode = 'rule' then nullif(p ->> 'department_id', '')::uuid end, case when v_mode = 'rule' then nullif(p ->> 'position_id', '')::uuid end,
            case when v_mode = 'rule' then nullif(p ->> 'user_group_id', '')::uuid end,
            v_mode = 'rule' and coalesce((p ->> 'include_future_users')::boolean, false),
            v_req, v_start, v_due_at, v_due_days, v_exp_at, v_exp_days, v_late, nullif(trim(p ->> 'notes'), ''), app.actor_id())
    returning * into a;
  end if;

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
  return jsonb_build_object('assignment_id', a.id, 'created', v_created, 'skipped', v_skipped, 'forbidden', v_forbidden, 'merged', v_merged);
end $$;
grant execute on function public.create_assignment(jsonb) to authenticated;

-- «Agregar personas» a una asignación de personas específicas.
create or replace function public.add_to_assignment(p_assignment uuid, p_user_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  a public.assignments;
  u uuid;
  v_created int := 0; v_skipped int := 0; v_forbidden int := 0;
begin
  select * into a from public.assignments where id = p_assignment;
  if not found then perform app.fail('NOT_FOUND', 'assignment'); end if;
  if not app.can_any('assignments.write') then perform app.fail('FORBIDDEN', 'assignments.write'); end if;
  if a.mode <> 'direct' then perform app.fail('VALIDATION', '{"mode":"direct_only"}'); end if;
  if not a.is_active then perform app.fail('VALIDATION', '{"assignment":"paused"}'); end if;
  if coalesce(array_length(p_user_ids, 1), 0) = 0 or array_length(p_user_ids, 1) > 2000 then perform app.fail('VALIDATION', '{"users":"required"}'); end if;
  if (select status from public.courses where id = a.course_id) = 'archived' then perform app.fail('COURSE_ARCHIVED'); end if;
  foreach u in array p_user_ids loop
    if not app.can_user('assignments.write', u) or not exists (select 1 from public.profiles where id = u and status = 'active') then
      v_forbidden := v_forbidden + 1;
    elsif app.create_enrollment(u, a.id) is null then v_skipped := v_skipped + 1;
    else v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'forbidden', v_forbidden);
end $$;
grant execute on function public.add_to_assignment(uuid, uuid[]) to authenticated;
