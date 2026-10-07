import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { toFriendlyError, type FriendlyError } from "@/lib/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: FriendlyError };

/** Error con mensaje ya pensado para el usuario. */
export class UserError extends Error {
  constructor(message: string, public code = "USER_ERROR", public fieldErrors?: Record<string, string>) {
    super(message);
  }
}

/**
 * Envuelve una Server Action: nunca lanza al cliente. Convierte errores de Zod, de negocio y de Postgres
 * en mensajes claros y registra el detalle técnico en los logs del servidor.
 */
export async function safe<T>(fn: () => Promise<ActionResult<T> | void>): Promise<ActionResult<T>> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of e.issues) fieldErrors[i.path.join(".")] ??= i.message;
      return { ok: false, error: { code: "VALIDATION", message: "Revisa los datos marcados.", fieldErrors } };
    }
    if (e instanceof UserError) return { ok: false, error: { code: e.code, message: e.message, fieldErrors: e.fieldErrors } };
    const friendly = toFriendlyError(e);
    if (friendly.code === "UNKNOWN") console.error("[action]", e);
    return { ok: false, error: friendly };
  }
}

/** Lanza si Supabase devolvió error (para usar dentro de safe). */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

/** Como must, pero además exige datos (consultas con .select()/.single()). */
export function mustData<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  if (res.data == null) throw new Error("Respuesta sin datos");
  return res.data as NonNullable<T>;
}
