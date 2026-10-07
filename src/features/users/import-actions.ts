"use server";
import ExcelJS from "exceljs";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { must, safe, UserError, type ActionResult } from "@/lib/action";
import { toFriendlyError } from "@/lib/errors";
import { APP_URL } from "@/lib/env";
import { norm } from "@/lib/format";

import { type ImportField, type CheckedRow, type ImportOutcome, type RawRow } from "./import-shared";

/** Encabezados aceptados (sin acentos ni mayúsculas) → campo. */
const HEADER_MAP: Record<string, ImportField> = {
  nombre: "nombre", nombres: "nombre", "nombre(s)": "nombre",
  apellido: "apellido_paterno", "apellido paterno": "apellido_paterno", paterno: "apellido_paterno",
  "apellido materno": "apellido_materno", materno: "apellido_materno",
  email: "email", correo: "email", "correo electronico": "email", "email corporativo": "email",
  empleado: "numero_empleado", "numero de empleado": "numero_empleado", "no. empleado": "numero_empleado", "num empleado": "numero_empleado", "numero empleado": "numero_empleado",
  usuario: "usuario", empresa: "empresa", sucursal: "sucursal", departamento: "departamento", area: "departamento",
  puesto: "puesto", jefe: "jefe", "jefe directo": "jefe", telefono: "telefono", celular: "telefono",
  "fecha de ingreso": "fecha_ingreso", ingreso: "fecha_ingreso", "fecha ingreso": "fecha_ingreso",
};

function parseCsv(text: string): string[][] {
  const sep = (text.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) > (text.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("hyperlink" in v && "text" in v) return String(v.text);
  }
  return String(v);
}

/** dd/mm/aaaa → aaaa-mm-dd (formato común en México). */
const isoDate = (s: string) => {
  const m = s.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s.trim();
};

async function readRows(file: File): Promise<RawRow[]> {
  const name = file.name.toLowerCase();
  let grid: string[][];
  if (name.endsWith(".csv")) {
    grid = parseCsv((await file.text()).replace(/^﻿/, ""));
  } else if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new UserError("El archivo no tiene hojas.");
    grid = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(r.getCell(c).value));
      grid.push(vals);
    });
  } else {
    throw new UserError("Sube un archivo .xlsx o .csv.");
  }
  if (grid.length < 2) throw new UserError("El archivo no tiene filas de datos.");
  const headers = grid[0].map((h) => HEADER_MAP[norm(h).replace(/\s+/g, " ")] ?? null);
  if (!headers.includes("nombre") || !headers.includes("empresa")) {
    throw new UserError("No encontramos las columnas Nombre y Empresa. Usa la plantilla.");
  }
  return grid.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const o: RawRow = {};
      headers.forEach((h, i) => { if (h && r[i] != null) o[h] = String(r[i]).trim(); });
      if (o.fecha_ingreso) o.fecha_ingreso = isoDate(o.fecha_ingreso);
      return o;
    });
}

async function check(rows: RawRow[]): Promise<CheckedRow[]> {
  const supabase = await createClient();
  const res = must(await supabase.rpc("admin_validate_import", { p_rows: rows }));
  return (res as Omit<CheckedRow, "raw">[]).map((r, i) => ({ ...r, raw: rows[i] }));
}

const MAX_BYTES = 5 * 1024 * 1024;

/** Paso 1: leer el archivo y validar (no escribe nada). */
export async function previewImport(_: unknown, fd: FormData): Promise<ActionResult<CheckedRow[]>> {
  return safe(async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Elige un archivo.");
    if (file.size > MAX_BYTES) throw new UserError("El archivo pesa más de 5 MB.");
    const rows = await readRows(file);
    if (rows.length > 2000) throw new UserError("Máximo 2,000 filas por importación. Divide el archivo.");
    return { ok: true, data: await check(rows) };
  });
}

const rawSchema = z.array(z.record(z.string(), z.string().max(200))).max(2000);

/** Paso 2 (opcional): revalidar después de corregir en pantalla. */
export async function revalidateImport(rows: RawRow[]): Promise<ActionResult<CheckedRow[]>> {
  return safe(async () => ({ ok: true, data: await check(rawSchema.parse(rows) as RawRow[]) }));
}

function tempPassword() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ", d = "23456789", all = A + d + "abcdefghjkmnpqrstuvwxyz";
  const pick = (s: string) => s[randomInt(s.length)];
  return `${pick(A)}${Array.from({ length: 4 }, () => pick(all)).join("")}-${pick(d)}${Array.from({ length: 4 }, () => pick(all)).join("")}`;
}

/** Paso 3: crear un lote (≤ 25) de filas ya validadas. Cada fila se revalida en la base al crearla. */
export async function importBatch(rows: CheckedRow[], mode: "invite_or_temp" | "temp"): Promise<ActionResult<ImportOutcome[]>> {
  return safe(async () => {
    if (rows.length > 25) throw new UserError("Lote demasiado grande.");
    const supabase = await createClient();
    must(await supabase.rpc("admin_validate_import", { p_rows: [] })); // verifica users.import antes de tocar Auth
    const admin = createAdminClient();
    const domain = process.env.INTERNAL_EMAIL_DOMAIN ?? "users.lms.internal";
    const out: ImportOutcome[] = [];
    for (const r of rows) {
      const d = r.data as Record<string, string | null>;
      const name = `${d.first_name ?? ""} ${d.last_name_paternal ?? ""}`.trim();
      const email = d.email ?? null;
      const authEmail = email ?? `${crypto.randomUUID()}@${domain}`;
      const invite = mode === "invite_or_temp" && !!email;
      let authId: string | undefined;
      let temp: string | undefined;
      try {
        if (invite) {
          const { data, error } = await admin.auth.admin.inviteUserByEmail(authEmail, { redirectTo: `${APP_URL}/auth/confirm?next=/definir-contrasena` });
          if (error || !data.user) throw new UserError("No se pudo enviar la invitación");
          authId = data.user.id;
        } else {
          temp = tempPassword();
          const { data, error } = await admin.auth.admin.createUser({ email: authEmail, password: temp, email_confirm: true });
          if (error || !data.user) throw new UserError(error?.code === "email_exists" ? "Correo ya registrado" : "No se pudo crear el acceso");
          authId = data.user.id;
        }
        const payload = { ...d, manager_id: d.manager_id ?? null, auth_email: authEmail, has_real_email: !!email, must_change_password: !invite, via_import: true };
        const created = await supabase.rpc("admin_create_user", { p_user_id: authId, p: payload });
        if (created.error) throw created.error;
        out.push({ row: r.row, ok: true, id: authId, name, login: email ?? d.username ?? d.employee_number ?? undefined, tempPassword: temp, invited: invite, manager_ref: r.manager_ref });
      } catch (e) {
        if (authId) await admin.auth.admin.deleteUser(authId);
        out.push({ row: r.row, ok: false, name, error: e instanceof UserError ? e.message : toFriendlyError(e).message });
      }
    }
    const { data: me } = await supabase.auth.getClaims();
    await admin.rpc("server_log", {
      p_actor: me?.claims?.sub ?? null, p_action: "user.imported", p_entity_type: "user",
      p_data: { created: out.filter((o) => o.ok).length, failed: out.filter((o) => !o.ok).length },
    });
    return { ok: true, data: out };
  });
}

/** Paso 4: ligar jefes que venían en el mismo archivo. */
export async function linkImportedManagers(links: { user_id: string; manager_ref: string }[]): Promise<ActionResult<{ linked: number; missing: unknown[] }>> {
  return safe(async () => {
    if (!links.length) return { ok: true, data: { linked: 0, missing: [] } };
    const supabase = await createClient();
    const res = must(await supabase.rpc("admin_link_managers", { p_links: links }));
    return { ok: true, data: res as { linked: number; missing: unknown[] } };
  });
}
