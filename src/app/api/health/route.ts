import { NextResponse } from "next/server";
import { siteUrl } from "@/features/certificates/server";

/** Para monitoreo: confirma que la app responde, qué versión está publicada y a qué dominio apuntan los QR. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    entorno: process.env.APP_ENV ?? "development",
    verificacion: `${await siteUrl()}/verify/certificate`,
  });
}
