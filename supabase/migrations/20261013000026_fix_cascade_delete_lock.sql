-- Corrige: en un borrador no se podía borrar una lección que tuviera contenido (ni un módulo con lecciones, ni un
-- examen con preguntas al azar). El borrado en cascada de los «hijos» corre cuando el padre ya no existe; el
-- candado no encontraba la versión y la trataba como publicada (VERSION_LOCKED).
-- Ahora, en un DELETE sin padre, se permite: el padre ya pasó por el mismo candado. En versiones publicadas el
-- padre sí se bloquea, así que la cascada nunca llega a correr.

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
  -- Borrado en cascada: el padre (lección o módulo) ya se borró en esta misma operación y su propio trigger ya
  -- validó la versión. Sin padre no hay versión que proteger.
  if tg_op = 'DELETE' and v_version is null then
    return old;
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
  -- Borrado en cascada desde el examen (o la versión): el padre ya se validó y ya no existe.
  if tg_op = 'DELETE' and v_version is null then return old; end if;
  if (select status from public.course_versions where id = v_version) = 'draft' then return coalesce(new, old); end if;
  if tg_table_name = 'exams' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'is_active' - 'available_from' - 'available_until' - 'updated_at')
       = (to_jsonb(old) - 'is_active' - 'available_from' - 'available_until' - 'updated_at') then
    return new;
  end if;
  perform app.fail('VERSION_LOCKED');
  return null;
end $$;
