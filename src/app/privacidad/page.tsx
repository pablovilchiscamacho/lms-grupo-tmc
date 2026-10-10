import type { Metadata } from "next";
import { BrandMark } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrivacyText } from "@/features/privacy/render";

export const metadata: Metadata = { title: "Aviso de privacidad" };
export const revalidate = 300;

/** Página pública: el aviso vigente del grupo. Cada empresa ve el suyo al ingresar. */
export default async function PublicPrivacyPage() {
  const { data } = await createAdminClient().from("privacy_notices")
    .select("title, body, version, published_at").is("company_id", null).eq("status", "published").maybeSingle();
  const body = data?.body.replaceAll("{{empresa}}", "Grupo TMC").replaceAll("{{fecha}}", data.published_at ? fmtDate(data.published_at) : "");
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <a href="/entrar"><BrandMark className="mb-6 text-brand-900" /></a>
        <div className="card p-5 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{data?.title ?? "Aviso de privacidad"}</h1>
          <div className="mt-5">
            {body ? <PrivacyText body={body} /> : <p className="text-sm text-slate-600">El aviso de privacidad se muestra a cada colaborador al ingresar a la plataforma. Para consultarlo, acude a Capital Humano de tu empresa.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
