import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { BrandMark } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { myPendingNotice } from "@/features/privacy/queries";
import { PrivacyText } from "@/features/privacy/render";
import { AcceptForm } from "@/features/privacy/ui/accept-form";

export const metadata: Metadata = { title: "Aviso de privacidad" };

export default async function AcceptPrivacyPage() {
  const ctx = await requireUser({ allowPrivacy: true });
  const notice = await myPendingNotice();
  if (!notice) redirect("/");
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <BrandMark className="mb-6 text-brand-900" />
        <div className="card p-5 sm:p-8">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{notice.company} · versión {notice.version} · {fmtDate(notice.published_at)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{notice.title}</h1>
          <p className="mt-2 text-sm text-slate-600">Hola, {ctx.profile.first_name}. Antes de continuar, lee cómo se usan tus datos en la plataforma de capacitación.</p>
          <div className="mt-5 max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
            <PrivacyText body={notice.body} />
          </div>
          <AcceptForm id={notice.id} />
        </div>
      </div>
    </div>
  );
}
