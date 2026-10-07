import { NextResponse } from "next/server";

/** Para monitoreo: confirma que la app responde y qué versión está publicada. */
export function GET() {
  return NextResponse.json({
    ok: true,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    entorno: process.env.APP_ENV ?? "development",
  });
}
