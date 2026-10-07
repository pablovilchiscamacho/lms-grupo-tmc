/**
 * Crea el PRIMER Super Admin en un proyecto nuevo (producción incluida). Después, todo se hace desde la app.
 *   npm run bootstrap:admin -- --email pablo@grupotmc.com.mx --nombre Pablo --apellido Vilchis --empresa "Grupo TMC"
 * Si la empresa no existe se crea. Envía invitación por correo; si el correo aún no está configurado,
 * usa --temporal para generar una contraseña temporal que se muestra una sola vez.
 */
import { randomBytes } from "node:crypto";
import { adminClient, maybe, must } from "./_admin-client";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const email = arg("email")?.toLowerCase(), nombre = arg("nombre"), apellido = arg("apellido"), empresa = arg("empresa") ?? "Grupo TMC";
const temporal = process.argv.includes("--temporal");
if (!email || !nombre || !apellido) {
  console.error('Uso: npm run bootstrap:admin -- --email X --nombre X --apellido X [--empresa "Grupo TMC"] [--temporal]');
  process.exit(1);
}
const sb = adminClient();

async function main() {
  const existing = maybe(await sb.from("user_roles").select("id, roles!inner(key)").eq("roles.key", "super_admin").is("revoked_at", null).limit(1), "consulta");
  if (existing?.length) { console.error("✗ Ya existe un Super Admin. Crea los demás usuarios desde la app."); process.exit(1); }

  let company = maybe(await sb.from("companies").select("id").eq("name", empresa).maybeSingle(), "empresa");
  company ??= must(await sb.from("companies").insert({ name: empresa, short_name: empresa.split(/\s+/).pop()!.slice(0, 20) }).select("id").single(), "crear empresa");

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let userId: string, temp: string | undefined;
  if (temporal) {
    temp = `Tmc-${randomBytes(6).toString("base64url")}`;
    const { data, error } = await sb.auth.admin.createUser({ email: email!, password: temp, email_confirm: true });
    if (error || !data.user) { console.error("✗", error); process.exit(1); }
    userId = data.user.id;
  } else {
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email!, { redirectTo: `${appUrl}/auth/confirm?next=/definir-contrasena` });
    if (error || !data.user) { console.error("✗ No se pudo invitar (¿SMTP configurado?). Repite con --temporal.", error); process.exit(1); }
    userId = data.user.id;
  }
  maybe(await sb.from("profiles").insert({ id: userId, first_name: nombre, last_name_paternal: apellido, email, auth_email: email, company_id: company.id, must_change_password: !!temp }), "perfil");
  const role = must(await sb.from("roles").select("id").eq("key", "super_admin").single(), "rol");
  maybe(await sb.from("user_roles").insert({ user_id: userId, role_id: role.id, scope_type: "group" }), "asignar rol");
  console.log(`✓ Super Admin creado: ${email}`);
  if (temp) console.log(`  Contraseña temporal (se pedirá cambiarla al entrar): ${temp}`);
  else console.log("  Se envió una invitación por correo.");
  console.log("  Al entrar se pedirá configurar la verificación en dos pasos (MFA).");
}
main();
