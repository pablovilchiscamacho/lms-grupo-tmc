-- ============================================================================
-- 0015 · Tableros: filtros "vencen esta semana" y "reprobados" en el cumplimiento por persona,
-- para que cada aviso de «Requiere atención» lleve a su detalle.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Cumplimiento por persona (tabla con semáforo, paginada en el servidor)
-- f.light: green (>= 90), amber (70–89), red (< 70), none (sin cursos); f.only_overdue, f.only_due_week, f.only_failed
-- p_sort: compliance (peor primero), -compliance (mejor primero), name, overdue
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_people(f jsonb default '{}', p_sort text default 'compliance', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not app.can_any('progress.read') then perform app.fail('FORBIDDEN', 'progress.read'); end if;
  f := coalesce(f, '{}');
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 500);

  with agg as (
    select e.user_id,
      count(*) as assigned,
      count(*) filter (where bucket = 'completed') as completed,
      count(*) filter (where bucket = 'pending') as pending,
      count(*) filter (where bucket = 'overdue') as overdue,
      count(*) filter (where bucket = 'failed') as failed,
      count(*) filter (where e.due_week) as due_week,
      round(avg(final_score) filter (where result in ('passed', 'failed')), 1) as avg_score
    from app.dash_enrollments('progress.read', f) e group by e.user_id
  ), rows as (
    select p.id, p.full_name, p.employee_number,
      c.short_name as company, b.name as branch, d.name as department, po.name as position,
      coalesce(a.assigned, 0) as assigned, coalesce(a.completed, 0) as completed, coalesce(a.pending, 0) as pending,
      coalesce(a.overdue, 0) as overdue, coalesce(a.failed, 0) as failed, coalesce(a.due_week, 0) as due_week, a.avg_score,
      app.pct(a.completed, a.assigned) as compliance
    from app.dash_people('progress.read', f) p
    join public.companies c on c.id = p.company_id
    left join public.branches b on b.id = p.branch_id
    left join public.departments d on d.id = p.department_id
    left join public.positions po on po.id = p.position_id
    left join agg a on a.user_id = p.id
    -- Con filtro de curso o de fechas solo cuenta quien tiene inscripciones que coinciden.
    where (a.user_id is not null or (nullif(f ->> 'course_id', '') is null and nullif(f ->> 'from', '') is null and nullif(f ->> 'to', '') is null))
  ), filtered as (
    select * from rows
    where (nullif(f ->> 'light', '') is null
           or (f ->> 'light' = 'green' and compliance >= 90)
           or (f ->> 'light' = 'amber' and compliance >= 70 and compliance < 90)
           or (f ->> 'light' = 'red' and compliance < 70)
           or (f ->> 'light' = 'none' and assigned = 0))
      and (coalesce((f ->> 'only_overdue')::boolean, false) = false or overdue > 0)
      and (coalesce((f ->> 'only_due_week')::boolean, false) = false or due_week > 0)
      and (coalesce((f ->> 'only_failed')::boolean, false) = false or failed > 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) - 'k1' - 'k2' order by x.k1, x.k2, x.full_name) from (
        select filtered.*,
          case p_sort
            when '-compliance' then -coalesce(compliance, -1)
            when 'overdue' then -overdue
            when 'name' then 0
            else coalesce(compliance, 1000) end as k1,
          case p_sort when '-compliance' then -coalesce(avg_score, -1) when 'overdue' then coalesce(compliance, 1000) else 0 end as k2
        from filtered
        order by k1, k2, full_name
        limit p_limit offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'::jsonb))
  into v;
  return v;
end $$;
grant execute on function public.dashboard_people(jsonb, text, int, int) to authenticated;
