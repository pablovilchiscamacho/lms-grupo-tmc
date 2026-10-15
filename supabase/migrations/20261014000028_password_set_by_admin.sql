-- Contraseñas que define Capital Humano: al asignarla desde la ficha puede elegir no pedir cambio al entrar.
create or replace function public.server_mark_user(p_user_id uuid, p_event text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.actor_id', p_user_id::text, true);
  if p_event = 'login' then
    -- last_login_at no se audita como cambio de perfil; se registra como evento de login.
    update public.profiles set last_login_at = now() where id = p_user_id;
  elsif p_event in ('password_changed', 'password_set_by_admin') then
    update public.profiles set must_change_password = false where id = p_user_id;
  elsif p_event = 'password_reset_by_admin' then
    update public.profiles set must_change_password = true where id = p_user_id;
  else
    perform app.fail('VALIDATION', 'event');
  end if;
end $$;
revoke execute on function public.server_mark_user(uuid, text) from public, anon, authenticated;
grant execute on function public.server_mark_user(uuid, text) to service_role;
