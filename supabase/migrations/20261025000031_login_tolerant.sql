-- Entrar con usuario o número de empleado tolerando los errores comunes al teclear en el celular (vistos en el
-- piloto de ATPVA): espacios de más («ramirez ortiz.jose»), una @ al inicio («@eleazar.gonzalez»), mayúsculas,
-- acentos y puntos/guiones. Primero se busca exacto (como antes); si no hay, se compara la versión «solo letras y
-- números», y SOLO si corresponde a una única persona (nunca adivina entre dos).
create or replace function app.login_key(p text)
returns text language sql immutable set search_path = ''
as $$ select regexp_replace(lower(app.unaccent_i(coalesce(p, ''))), '[^a-z0-9]', '', 'g') $$;

create or replace function public.resolve_login(p_identifier text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id text := lower(trim(p_identifier));
  v_key text;
  v_rows record;
  v_count int;
begin
  -- «@usuario» (sin dominio) es un usuario, no un correo.
  if left(v_id, 1) = '@' and position('@' in substr(v_id, 2)) = 0 then v_id := substr(v_id, 2); end if;
  v_id := regexp_replace(v_id, '\s+', '', 'g');
  if v_id = '' then return null; end if;
  if position('@' in v_id) > 0 then
    select auth_email, status into v_rows from public.profiles
     where lower(email) = v_id or lower(auth_email) = v_id limit 1;
    return case when v_rows is null then null else jsonb_build_object('auth_email', v_rows.auth_email, 'status', v_rows.status) end;
  end if;
  select auth_email, status into v_rows from public.profiles where lower(username) = v_id limit 1;
  if found then
    return jsonb_build_object('auth_email', v_rows.auth_email, 'status', v_rows.status);
  end if;
  -- Número de empleado: solo si es único en todo el grupo (entre perfiles no eliminados).
  select count(*) into v_count from public.profiles where lower(employee_number) = v_id and status <> 'deleted';
  if v_count = 1 then
    select auth_email, status into v_rows from public.profiles where lower(employee_number) = v_id and status <> 'deleted';
    return jsonb_build_object('auth_email', v_rows.auth_email, 'status', v_rows.status);
  end if;
  -- Tolerante: mismo usuario sin espacios, acentos, puntos ni guiones, y solo si es una sola persona.
  v_key := app.login_key(v_id);
  if length(v_key) >= 3 then
    select count(*) into v_count from public.profiles where status <> 'deleted' and username is not null and app.login_key(username) = v_key;
    if v_count = 1 then
      select auth_email, status into v_rows from public.profiles where status <> 'deleted' and username is not null and app.login_key(username) = v_key;
      return jsonb_build_object('auth_email', v_rows.auth_email, 'status', v_rows.status);
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.resolve_login(text) from public, anon, authenticated;
grant execute on function public.resolve_login(text) to service_role;
