// Restaura un respaldo cifrado sobre una base con las migraciones ya aplicadas (por ejemplo, un proyecto nuevo de Supabase).
// BORRA los datos actuales de esa base.  Uso:
//   npm run db:restore -- <archivo.lmsbk> --ref <ref-del-proyecto-destino> --host <pooler> --yes
// Para restaurar sobre producción hay que repetir su ref en --confirmar-produccion <ref>.
import fs from "node:fs";
import { decrypt, restore } from "./lib/backup-core.mjs";
import { connect, loadEnv, projectRef } from "./lib/db-env.mjs";

const env = loadEnv();
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const file = process.argv[2];
const ref = arg("--ref");
if (!file || !ref || !process.argv.includes("--yes")) {
  console.error("Uso: npm run db:restore -- <archivo.lmsbk> --ref <proyecto-destino> [--host <pooler>] [--password-env VAR] --yes");
  process.exit(1);
}
if (ref === projectRef(env) && arg("--confirmar-produccion") !== ref) {
  console.error(`✗ ${ref} es PRODUCCIÓN. Si de verdad quieres reemplazar sus datos, agrega --confirmar-produccion ${ref}`);
  process.exit(1);
}
const lines = decrypt(fs.readFileSync(file), env.BACKUP_PASSPHRASE ?? "");
const pw = arg("--password-env");
const { client, q } = await connect(pw ? { ...env, SUPABASE_DB_PASSWORD: env[pw] } : env, { ref, host: arg("--host") });
const r = await restore(q, lines, (m) => console.log("  ", m));
const broken = (await q("select audit.verify_chain() as b"))[0].b;
await client.end();
console.log(r.mismatched.length ? `✗ Diferencias: ${JSON.stringify(r.mismatched)}` : "✓ Todas las tablas coinciden con el respaldo");
console.log(broken === null ? "✓ Bitácora íntegra" : `✗ La bitácora no verifica desde el registro ${broken}`);
console.log(`Respaldo del ${r.manifest.created_at} (${r.manifest.migrations.length} migraciones). Recuerda: los archivos de Storage no van en este respaldo.`);
