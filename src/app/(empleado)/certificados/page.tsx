import type { Metadata } from "next";
import { Award, Download, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";
import { certState, myCertificates } from "@/features/certificates/queries";
import { prettyCode } from "@/features/certificates/format";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Certificados" };

const STATE = { valid: ["Vigente", "green"], expired: ["Vencida", "amber"], revoked: ["Revocada", "red"] } as const;

export default async function CertificatesPage() {
  const ctx = await requireUser();
  const tz = ctx.profile.company.timezone;
  const list = await myCertificates(ctx.profile.id);
  return (
    <>
      <PageHeader title="Certificados" description="Las constancias de los cursos que aprobaste. Cada una tiene un código QR para que cualquiera compruebe que es auténtica." />
      {list.length === 0 ? (
        <EmptyState icon={<Award className="size-8" />} title="Aún no tienes constancias">Cuando apruebes un curso, tu constancia aparecerá aquí lista para descargar.</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.map((c) => {
            const st = certState(c);
            const [label, tone] = STATE[st];
            return (
              <li key={c.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Award className="size-5" aria-hidden /></span>
                    <div>
                      <h2 className="font-semibold text-slate-900">{c.course_title}</h2>
                      <p className="text-xs text-slate-500">Folio {c.number}</p>
                    </div>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-500">Aprobado</dt><dd className="font-medium text-slate-800">{fmtDate(c.issued_at, tz)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Calificación</dt><dd className="font-medium text-slate-800">{c.score != null ? `${Number(c.score)}%` : "Acreditado"}</dd></div>
                  <div><dt className="text-xs text-slate-500">Vigencia</dt><dd className="font-medium text-slate-800">{c.expires_at ? fmtDate(c.expires_at, tz) : "Sin vencimiento"}</dd></div>
                </dl>
                {st === "revoked" && c.revoked_reason && <p className="mt-2 text-xs text-red-700">Revocada: {c.revoked_reason}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  {st !== "revoked" && <a href={`/api/certificates/${c.id}/pdf`} className="btn-primary"><Download className="size-4" /> Descargar PDF</a>}
                  <a href={`/verify/certificate/${c.verification_code}`} target="_blank" rel="noreferrer" className="btn-ghost"><ExternalLink className="size-4" /> Ver verificación</a>
                  <span className="ml-auto font-mono text-[11px] text-slate-400">{prettyCode(c.verification_code)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
