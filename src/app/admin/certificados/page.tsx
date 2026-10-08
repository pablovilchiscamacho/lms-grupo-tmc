import type { Metadata } from "next";
import Link from "next/link";
import { Award, Download, ExternalLink, Search } from "lucide-react";
import { can, requirePermission } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";
import { certificateSettings, certState, CERT_PAGE, listCertificates } from "@/features/certificates/queries";
import { filterOptions } from "@/features/dashboards/queries";
import { RevokeButton, SignerForm } from "@/features/certificates/ui/admin-controls";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Certificados" };

const STATE = { valid: ["Vigente", "green"], expired: ["Vencida", "amber"], revoked: ["Revocada", "red"] } as const;

export default async function AdminCertificates({ searchParams }: PageProps<"/admin/certificados">) {
  const ctx = await requirePermission("certificates.read", "/admin/certificados");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const canRevoke = can(ctx, "certificates.revoke");
  const canSettings = can(ctx, "settings.manage");
  const [{ rows, total, page }, opts, settings] = await Promise.all([
    listCertificates({ q: s("q"), status: s("estado"), course: s("curso"), page: Number(s("pagina")) || 1 }),
    filterOptions(), canSettings ? certificateSettings() : null,
  ]);
  const pages = Math.max(1, Math.ceil(total / CERT_PAGE));
  const filtered = Boolean(s("q") || s("estado") || s("curso"));

  return (
    <div className="space-y-5">
      <PageHeader title="Certificados" description={`${total.toLocaleString("es-MX")} constancia${total === 1 ? "" : "s"}${filtered ? " con esos filtros" : " emitidas"}. Se emiten solas cuando alguien aprueba un curso que da constancia.`} />

      <form className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Filtrar constancias">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" aria-hidden />
          <label htmlFor="q" className="sr-only">Buscar</label>
          <input id="q" name="q" defaultValue={s("q")} placeholder="Nombre, folio o curso…" className="input pl-9" />
        </div>
        <select name="estado" defaultValue={s("estado")} className="input" aria-label="Estado">
          <option value="">Estado: todas</option><option value="vigentes">Vigentes</option><option value="vencidas">Vencidas</option><option value="revocadas">Revocadas</option>
        </select>
        <select name="curso" defaultValue={s("curso")} className="input" aria-label="Curso">
          <option value="">Curso: todos</option>
          {opts.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4">
          {filtered && <Link href="/admin/certificados" className="btn-ghost">Limpiar</Link>}
          <button className="btn-secondary">Aplicar filtros</button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={<Award className="size-8" />} title={filtered ? "Ninguna constancia coincide" : "Todavía no hay constancias"}>
          {!filtered && "Aparecerán aquí en cuanto alguien apruebe un curso."}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Folio</th><th className="th">Persona</th><th className="th">Curso</th><th className="th">Aprobado</th>
                <th className="th">Vigencia</th><th className="th text-right">Calificación</th><th className="th">Estado</th><th className="th w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => {
                const st = certState(c);
                const [label, tone] = STATE[st];
                return (
                  <tr key={c.id}>
                    <td className="td font-mono text-xs whitespace-nowrap text-slate-700">{c.number}</td>
                    <td className="td"><Link href={`/admin/usuarios/${c.user_id}`} className="font-medium text-slate-900 hover:underline">{c.holder_name}</Link><div className="text-xs text-slate-500">{c.company_name}</div></td>
                    <td className="td text-slate-700">{c.course_title}<div className="text-xs text-slate-500">{c.course_code}</div></td>
                    <td className="td text-slate-600">{fmtDate(c.issued_at)}</td>
                    <td className="td text-slate-600">{c.expires_at ? fmtDate(c.expires_at) : "Sin vencimiento"}</td>
                    <td className="td text-right tabular-nums">{c.score != null ? `${Number(c.score)}%` : "—"}</td>
                    <td className="td"><Badge tone={tone}>{label}</Badge>{st === "revoked" && c.revoked_reason && <div className="mt-0.5 max-w-48 text-xs text-slate-500">{c.revoked_reason}</div>}</td>
                    <td className="td">
                      <div className="flex justify-end gap-0.5">
                        {st !== "revoked" && <a href={`/api/certificates/${c.id}/pdf`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Descargar ${c.number}`} title="Descargar PDF"><Download className="size-4" /></a>}
                        <a href={`/verify/certificate/${c.verification_code}`} target="_blank" rel="noreferrer" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Verificar ${c.number}`} title="Ver verificación pública"><ExternalLink className="size-4" /></a>
                        {canRevoke && c.status === "valid" && <RevokeButton id={c.id} number={c.number} holder={c.holder_name} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={pages} params={sp} />

      {settings && (
        <Card title="Firma de las constancias" className="max-w-xl">
          <p className="mb-3 text-sm text-slate-600">Aparece al pie de cada constancia nueva. Las ya emitidas conservan la firma con la que se emitieron.</p>
          <SignerForm initial={settings} />
        </Card>
      )}
    </div>
  );
}
