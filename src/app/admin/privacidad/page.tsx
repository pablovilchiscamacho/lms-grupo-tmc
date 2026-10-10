import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { privacyOverview } from "@/features/privacy/queries";
import { PRIVACY_TEMPLATE, PRIVACY_TEMPLATE_TITLE } from "@/features/privacy/template";
import { NoticeEditor } from "@/features/privacy/ui/notice-editor";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Aviso de privacidad" };

export default async function PrivacyAdmin() {
  await requirePermission(["users.read", "settings.manage"], "/admin/privacidad");
  const o = await privacyOverview();
  const supabase = await createClient();
  const { data: companies } = o.can_edit ? await supabase.from("companies").select("id, name").order("name") : { data: [] };
  const scopes = [{ id: null as string | null, name: "Todo el grupo (predeterminado)" }, ...(companies ?? [])];
  const pct = o.total ? Math.round((o.accepted / o.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Aviso de privacidad" description="Cada persona debe aceptar el aviso vigente de su empresa al ingresar. Si una empresa no tiene aviso propio, se usa el del grupo." />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Personas con aviso" value={o.total} />
        <Stat label="Ya aceptaron" value={o.accepted} tone="green" />
        <Stat label="Pendientes" value={o.total - o.accepted} tone={o.total - o.accepted ? "amber" : undefined} />
        <Stat label="Avance" value={`${pct}%`} />
      </section>

      <Card title="Avisos">
        {o.notices.length === 0 && !o.can_edit ? <EmptyState icon={<ShieldCheck className="size-7" />} title="Todavía no hay aviso publicado" /> : (
          <div className="space-y-6">
            {scopes.map((s) => {
              const pub = o.notices.find((n) => n.company_id === s.id && n.status === "published");
              const draft = o.notices.find((n) => n.company_id === s.id && n.status === "draft");
              if (!o.can_edit && !pub) return null;
              return (
                <div key={s.id ?? "grupo"} className="space-y-3 border-b border-slate-100 pb-6 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{s.name}</h3>
                    {pub ? <Badge tone="green">Versión {pub.version} vigente desde {fmtDate(pub.published_at)}</Badge>
                      : <Badge tone="slate">{s.id ? "Usa el del grupo" : "Sin publicar"}</Badge>}
                    {draft && <Badge tone="amber">Borrador sin publicar</Badge>}
                  </div>
                  {o.can_edit && (
                    <NoticeEditor companyId={s.id} draftId={draft?.id ?? null}
                      title={draft?.title ?? pub?.title ?? PRIVACY_TEMPLATE_TITLE}
                      body={draft?.body ?? pub?.body ?? PRIVACY_TEMPLATE} hasPublished={Boolean(pub)} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title={`Quién falta por aceptar${o.pending.length === 200 ? " (primeros 200)" : ""}`}>
        {o.pending.length === 0 ? <p className="text-sm text-slate-600">{o.total ? "Todas las personas ya aceptaron el aviso vigente." : "Aún no hay aviso publicado."}</p> : (
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {o.pending.map((p) => (
              <li key={p.id} className="min-w-0 truncate"><Link href={`/admin/usuarios/${p.id}`} className="text-brand-700 hover:underline">{p.name}</Link>{p.employee_number && <span className="text-slate-500"> · {p.employee_number}</span>}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
