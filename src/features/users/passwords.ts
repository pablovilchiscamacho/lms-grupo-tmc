import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { UserError } from "@/lib/action";

/**
 * Contraseñas que asigna Capital Humano. A petición de ATPVA, CH define y conserva la contraseña de cada persona
 * (como ya lo hacía) y, por omisión, no se pide cambiarla al entrar. Mínimo 6 caracteres, sin más reglas.
 */
export const PASSWORD_MIN = 6;

const WORDS = ["Sol", "Mar", "Luna", "Rio", "Pino", "Lago", "Nube", "Roca", "Faro", "Puma", "Oso", "Lobo", "Gato", "Coco", "Lima",
  "Pera", "Uva", "Kiwi", "Toro", "Pato", "Rayo", "Cielo", "Monte", "Playa", "Campo", "Flor", "Hoja", "Rosa", "Mango", "Nopal",
  "Maiz", "Cafe", "Miel", "Trigo", "Cobre", "Plata", "Oro", "Arena", "Brisa", "Selva"];

/** Fácil de dictar y teclear en el celular: «Sol-4827». */
export function easyPassword() {
  return `${WORDS[randomInt(WORDS.length)]}-${String(randomInt(10000)).padStart(4, "0")}`;
}

/** Contraseña escrita por CH (opcional): vacía → null; corta → error claro. */
export function chosenPassword(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const r = z.string().min(PASSWORD_MIN).max(72).safeParse(s);
  if (!r.success) throw new UserError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`, "VALIDATION", { password: `Mínimo ${PASSWORD_MIN} caracteres` });
  return s;
}
