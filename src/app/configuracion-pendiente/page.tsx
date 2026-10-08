import { BrandMark, Alert } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";
import { redirect } from "next/navigation";

export default function SetupPendingPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <BrandMark size="lg" className="mb-8 text-brand-900" />
      <h1 className="text-2xl font-semibold text-slate-900">Falta conectar la base de datos</h1>
      <p className="mt-2 text-slate-600">La aplicación está instalada, pero todavía no tiene las llaves del proyecto de Supabase.</p>
      <div className="mt-6"><Alert kind="info" title="Qué hacer">
        Copia <code>.env.example</code> como <code>.env.local</code> y llena <code>NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
        <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> y <code>SUPABASE_SECRET_KEY</code>. Los pasos están en <code>docs/DEPLOYMENT.md</code>.
      </Alert></div>
    </main>
  );
}
