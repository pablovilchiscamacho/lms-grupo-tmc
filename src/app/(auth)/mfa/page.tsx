import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { MfaFlow } from "./mfa-flow";

export const metadata: Metadata = { title: "Verificación en dos pasos" };

export default async function MfaPage({ searchParams }: PageProps<"/mfa">) {
  await requireUser();
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/admin";
  return <MfaFlow next={next} />;
}
