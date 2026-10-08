-- ============================================================================
-- 0021 · Correos con el logo de Grupo TMC en el encabezado (el logo se sirve desde el sitio: /brand/grupo-tmc.png).
-- ============================================================================

create or replace function app.email_html(p_name text, p_title text, p_body text, p_url text, p_button text default 'Abrir la plataforma')
returns text language sql immutable set search_path = ''
as $$
  select format($html$<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="padding:18px 24px;border-bottom:4px solid #1F2A51"><img src="%s" alt="Grupo TMC" width="140" height="45" style="display:block;border:0;height:45px;width:140px"><span style="display:block;margin-top:6px;font-size:12px;color:#64748b;letter-spacing:.5px">CAPACITACIÓN</span></td></tr>
<tr><td style="padding:28px 24px 8px">
<p style="margin:0 0 6px;font-size:14px;color:#64748b">Hola%s,</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f2a4a">%s</h1>
%s
<p style="margin:24px 0 8px"><a href="%s" style="display:inline-block;background:#24508d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;font-size:14px">%s</a></p>
</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9">Aviso automático de la plataforma de capacitación de Grupo TMC. No respondas a este correo; si tienes dudas, acude con tu jefe o con el área de Capacitación.</td></tr>
</table></td></tr></table></body></html>$html$,
    app.html_escape(regexp_replace(coalesce(p_url, ''), '^(https?://[^/]+).*$', '\1') || '/brand/grupo-tmc.png'),
    case when coalesce(p_name, '') = '' then '' else ' ' || app.html_escape(p_name) end,
    app.html_escape(p_title),
    case when coalesce(p_body, '') = '' then '' else '<p style="margin:0;font-size:15px;line-height:1.5;color:#334155">' || replace(app.html_escape(p_body), E'\n', '<br>') || '</p>' end,
    app.html_escape(p_url), app.html_escape(p_button))
$$;
