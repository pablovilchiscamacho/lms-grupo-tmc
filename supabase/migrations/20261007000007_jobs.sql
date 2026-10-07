-- =====================================================================
-- 0007 · Tareas programadas (pg_cron)
-- Se omiten si pg_cron no está disponible (por ejemplo, en las pruebas locales con PGlite).
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Sella la bitácora (cadena de hash) cada minuto.
    perform cron.schedule('audit-seal', '* * * * *', 'select audit.seal()');
    -- Limpia ventanas de rate limit viejas cada hora.
    perform cron.schedule('rate-limits-cleanup', '17 * * * *',
      $job$delete from app.rate_limits where window_start < now() - interval '1 day'$job$);
  end if;
end $$;
