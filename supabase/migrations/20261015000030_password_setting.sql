-- La configuración informativa de contraseñas refleja la regla vigente (mínimo 6, la asigna Capital Humano).
update public.settings set value = '{"min_length": 6, "assigned_by_hr": true}'::jsonb where key = 'security.passwords' and company_id is null;
