// Respaldo lógico y cifrado de la base del LMS.  Uso: npm run db:backup [-- --out <carpeta>]
// Requiere BACKUP_PASSPHRASE (≥ 16 caracteres). Sin ella no hay respaldo: un respaldo sin cifrar con datos personales no se guarda.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { dump, encrypt } from "./lib/backup-core.mjs";
import { connect, loadEnv } from "./lib/db-env.mjs";

const env = loadEnv();
const outArg = process.argv.indexOf("--out");
const outDir = outArg > 0 ? process.argv[outArg + 1] : path.join(os.homedir(), "Respaldos-LMS");
if (!env.BACKUP_PASSPHRASE || env.BACKUP_PASSPHRASE.length < 16) {
  console.error("✗ Falta BACKUP_PASSPHRASE (mínimo 16 caracteres) en .env.local o en el entorno.");
  process.exit(1);
}
const { client, q, ref } = await connect(env);
await q("begin isolation level repeatable read read only");   // foto consistente de toda la base
const { manifest, lines } = await dump(q, { project: ref });
await q("commit");
await client.end();

const enc = encrypt(lines, env.BACKUP_PASSPHRASE);
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const file = path.join(outDir, `lms-respaldo-${stamp}.lmsbk`);
fs.writeFileSync(file, enc, { mode: 0o600 });
const rows = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
console.log(`✓ Respaldo cifrado: ${file}`);
console.log(`  ${Object.keys(manifest.counts).length} tablas · ${rows.toLocaleString("es-MX")} filas · ${(enc.length / 1024).toFixed(0)} KB · ${manifest.migrations.length} migraciones`);
console.log(`  sha256 ${crypto.createHash("sha256").update(enc).digest("hex")}`);
