import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, CircleX, Clock3, SearchX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { BrandMark } from "@/components/ui";
import { verifyAllowed } from "@/features/certificates/server";
import { prettyCode } from "@/features/certificates/format";

export const metadata: Metadata = { title: "Verificar constancia" };

type Result = {
  number: string; holder_name: string; course_title: string; company_name: string; issued_at: string;
  expires_at: string | null; score: number | null; status: "valid" | "expired" | "revoked"; revoked_at: string | null;
};

const STATE = {
  valid: { icon: BadgeCheck, title: "Constancia válida", text: "Esta constancia fue emitida por Grupo TMC y está vigente.", box: "border-emerald-200 bg-emerald-50", ic: "text-emerald-600" },
  expired: { icon: Clock3, title: "Constancia vencida", text: "Fue emitida por Grupo TMC, pero su vigencia ya terminó.", box: "border-amber-200 bg-amber-50", ic: "text-amber-600" },
  revoked: { icon: CircleX, title: "Constancia revocada", text: "Grupo TMC revocó esta constancia: ya no tiene validez.", box: "border-red-200 bg-red-50", ic: "text-red-600" },
} as const;

/** Verificación pública (sin sesión) de una constancia por su código: lo que abre el QR. */
export default async function VerifyPage({ params }: PageProps<"/verify/certificate/[code]">) {
  const { code } = await params;
  const clean = decodeURIComponent(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
  let r: Result | null = null;
  let limited = false;
  if (/^[A-Z2-9]{16}$/.test(clean)) {
    if (!(await verifyAllowed())) limited = true;
    else r = ((await (await createClient()).rpc("verify_certificate", { p_code: clean })).data as Result | null) ?? null;
  }
  const s = r ? STATE[r.status] : null;

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-10">
      <BrandMark className="mb-8 text-brand-900" />
      <div className="w-full max-w-lg">
        {limited ? (
          <Panel icon={SearchX} title="Demasiadas consultas" text="Espera un minuto e inténtalo de nuevo." />
        ) : !r || !s ? (
          <Panel icon={SearchX} title="No encontramos esta constancia"
            text="Revisa que el código esté completo (16 caracteres). Si la constancia es reciente, pide a la persona que la descargue de nuevo." />
        ) : (
          <section className={`rounded-2xl border p-6 shadow-sm ${s.box}`} aria-live="polite">
            <div className="flex items-start gap-3">
              <s.icon className={`size-8 shrink-0 ${s.ic}`} aria-hidden />
              <div>
                <h1 className="text-xl font-semibold text-slate-900">{s.title}</h1>
                <p className="mt-0.5 text-sm text-slate-600">{s.text}</p>
              </div>
            </div>
            <dl className="mt-5 grid gap-3 rounded-xl bg-white p-4 text-sm sm:grid-cols-2">
              <Item k="Otorgada a" v={r.holder_name} wide />
              <Item k="Curso" v={r.course_title} wide />
              <Item k="Empresa" v={r.company_name} />
              <Item k="Folio" v={r.number} />
              <Item k="Fecha de aprobación" v={fmtDate(r.issued_at)} />
              <Item k="Vigencia" v={r.expires_at ? `Hasta ${fmtDate(r.expires_at)}` : "Sin vencimiento"} />
              {r.score != null && <Item k="Calificación" v={`${Number(r.score)}%`} />}
              {r.status === "revoked" && r.revoked_at && <Item k="Revocada el" v={fmtDate(r.revoked_at)} />}
            </dl>
            <p className="mt-3 text-xs text-slate-500">Código de verificación {prettyCode(clean)}</p>
          </section>
        )}
        <p className="mt-6 text-center text-xs text-slate-500">
          Plataforma de capacitación de Grupo TMC · <Link href="/verify/certificate" className="underline">Verificar otro código</Link>
        </p>
      </div>
    </main>
  );
}

function Panel({ icon: Icon, title, text }: { icon: typeof SearchX; title: string; text: string }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <Icon className="mx-auto size-9 text-slate-400" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{text}</p>
    </section>
  );
}

function Item({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{k}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{v}</dd>
    </div>
  );
}
