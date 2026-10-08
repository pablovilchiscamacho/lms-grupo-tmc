# DEPLOYMENT.md: cómo poner a funcionar el LMS

Esta guía tiene dos partes: **desarrollo** (un proyecto de Supabase para probar) y **producción**. Los pasos marcados con 👤 los haces tú en el navegador. Los de terminal los puedo correr yo, pero las llaves las pegas tú directamente en el archivo `.env.local` o en Vercel, nunca en el chat.

---

## 1. Proyecto de Supabase de desarrollo (gratis)

1. 👤 Entra a <https://supabase.com/dashboard> → **New project**.
   - Nombre: `lms-grupo-tmc-dev`. Región: **East US (North Virginia)**, la más cercana a México con buena latencia.
   - Contraseña de la base: genérala y **guárdala en tu gestor de contraseñas**. No la mandes por chat.
2. 👤 **Project Settings → API Keys**: copia la *Project URL*, la *publishable key* y la *secret key*.
3. 👤 En la carpeta del proyecto, copia `.env.example` como `.env.local` y pega ahí las tres llaves.
4. Aplicar las migraciones (pide la contraseña de la base):
   ```bash
   npx supabase login
   ```
   ```bash
   npx supabase link --project-ref <ref-del-proyecto>
   ```
   ```bash
   npm run db:push
   ```
5. 👤 **Authentication → Sign In / Providers**:
   - **Allow new users to sign up: APAGADO**. Es obligatorio: solo los administradores dan de alta usuarios.
   - Email: habilitado. *Confirm email*: encendido.
6. 👤 **Authentication → Multi-Factor**: TOTP habilitado (viene así por defecto).
7. 👤 **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` en desarrollo, o la URL de producción.
   - Redirect URLs: agrega `http://localhost:3000/**` y la de producción `https://<dominio>/**`.
8. 👤 **Authentication → Emails → Templates**: para que los enlaces funcionen con el servidor, cambia el enlace de estas dos plantillas:
   - **Invite user**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/definir-contrasena`
   - **Reset password**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/definir-contrasena`

   Los textos sugeridos en español están en la §5.
9. Datos demo (empresas, departamentos y 9 usuarios de ejemplo):
   ```bash
   npm run seed:demo
   ```
   La contraseña de los usuarios demo se imprime al final, o se toma de `SEED_PASSWORD`. Con `-- --sin-mfa` se desactiva el doble factor de los administradores, **solo en desarrollo**.
10. Arrancar la app:
    ```bash
    npm run dev
    ```

> Mientras no configures el correo propio (paso 5 de producción), Supabase solo envía correos a los miembros de tu equipo de Supabase, y con un límite bajo. Por eso, en desarrollo, crea a los usuarios con **contraseña temporal**.

---

## 2. Producción

1. 👤 Crea un segundo proyecto de Supabase: `lms-grupo-tmc`, plan **Pro** (D11), región East US. Repite los pasos 2 a 8 de la sección 1 con la URL de producción.
2. 👤 **Project Settings → Add-ons / Backups**: confirma que los respaldos diarios estén activos (vienen incluidos en Pro).
3. 👤 **Authentication → Policies → Password**: longitud mínima 10 y **Leaked password protection: ON**.
4. 👤 En Vercel, crea un proyecto nuevo desde el repositorio `lms-grupo-tmc` (plan **Pro**) y define estas variables de entorno (*Production*):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`, `APP_ENV=production` e `INTERNAL_EMAIL_DOMAIN`.
5. 👤 **Correo (D3, Resend):**
   1. Crea una cuenta en <https://resend.com>, agrega el dominio (por ejemplo `grupotmc.com.mx`) y pide a sistemas que dé de alta los registros DNS que indica Resend (SPF y DKIM, más DMARC recomendado).
   2. En Supabase, ve a **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
      - Host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = API key de Resend.
      - Remitente: `no-responder@grupotmc.com.mx`, nombre "Capacitación Grupo TMC".
6. Aplica las migraciones a producción (`supabase link` al proyecto de producción y luego `npm run db:push`).
7. Crea el **primer Super Admin** (una sola vez):
   ```bash
   npm run bootstrap:admin -- --email tu@correo.com --nombre Nombre --apellido Apellido --empresa "Grupo TMC"
   ```
   Si el correo aún no está configurado, agrega `--temporal`.
8. Entra a la app, configura tu verificación en dos pasos y da de alta las empresas, sucursales y departamentos (**Organización**). Después, importa a los usuarios (**Usuarios → Importar**).
9. 👤 **Storage → Settings**: sube el *Upload file size limit* a **1 GB**, para que quepan los videos.
10. 👤 (Opcional) **Conversión de PowerPoint a PDF**: crea una cuenta en <https://cloudconvert.com>, genera una API key (permisos `task.read` y `task.write`) y ponla en Vercel como `CLOUDCONVERT_API_KEY`. Sin ella, el administrador adjunta el PDF a mano.
11. Verifica `https://<dominio>/api/health`: debe responder `{"ok":true,"version":"<commit>"}`.

**Nunca** corras `npm run seed:demo` contra producción. El script se niega a correr con `APP_ENV=production`.

---

## 3. Actualizaciones

**Cambios de base de datos (sin pegar SQL):** con `SUPABASE_DB_PASSWORD` y `SUPABASE_DB_HOST` en `.env.local`, se aplica lo pendiente con:

```bash
npm run db:migrate
```

Con `npm run db:migrate -- --status` se ve qué falta, sin aplicar nada. El proyecto de producción está en la región **ca-central-1** (`aws-1-ca-central-1.pooler.supabase.com`). Las migraciones se registran en `supabase_migrations.schema_migrations`, la misma tabla que usa la CLI de Supabase.


1. Las migraciones nuevas se agregan en `supabase/migrations/` y se aplican primero en desarrollo y luego en producción con `npm run db:push`.
2. Vercel publica solo al hacer *push* a `main`.
3. Después de cada publicación, revisa que `/api/health` reporte la versión nueva.

## 4. Tipos de TypeScript desde la base

Una vez enlazado el proyecto: `npm run db:types` genera `src/types/database.ts`. Pendiente: tipar los clientes con esos tipos generados cuando exista el proyecto de desarrollo.

## 5. Textos sugeridos para los correos de Supabase

**Invitación**: asunto "Tu acceso a Capacitación Grupo TMC":
> Hola. Se creó tu cuenta en la plataforma de capacitación de Grupo TMC. Para definir tu contraseña, entra a este enlace (vence en 24 horas): **[Definir mi contraseña]**. Si no esperabas este correo, ignóralo.

**Restablecer contraseña**: asunto "Restablece tu contraseña":
> Recibimos una solicitud para restablecer tu contraseña. Entra a este enlace (vence en 1 hora): **[Restablecer contraseña]**. Si no la pediste, ignora este correo: tu contraseña no cambia.

## Correo (Resend)
1. Cuenta en resend.com → **Domains** → agregar el dominio y copiar sus registros DNS (SPF, DKIM y, recomendado, DMARC) en el proveedor del dominio. Esperar a que diga *Verified*.
2. **API Keys** → crear una con permiso *Sending access* → pegarla en `.env.local` como `RESEND_API_KEY=` → `npm run email:key` (la guarda cifrada en Supabase Vault).
3. En la plataforma: **Notificaciones** → remitente con el dominio verificado → encender el correo → mandar una prueba.
4. Recuperación de contraseña (la manda Supabase Auth): Supabase → Authentication → Emails → **SMTP Settings** → host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = la clave de Resend, remitente con el dominio verificado. Sin esto, Supabase solo envía unos pocos correos por hora y únicamente a los miembros del equipo del proyecto.

