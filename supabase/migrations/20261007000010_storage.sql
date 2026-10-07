-- =====================================================================
-- 0010 · Buckets de Storage (todos privados)
-- No hay políticas sobre storage.objects para anon/authenticated: todo acceso pasa por
-- URLs firmadas que emite el servidor después de autorizar (file_prepare_upload / file_access).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('course-content', 'course-content', false, 1073741824, array[
     'application/pdf',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'video/mp4', 'image/jpeg', 'image/png', 'image/webp']),
  ('certificates', 'certificates', false, 10485760, array['application/pdf']),
  ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('branding', 'branding', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;
