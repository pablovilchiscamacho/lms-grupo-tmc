import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "@/features/users/import-wizard";

export const metadata: Metadata = { title: "Importar usuarios" };

export default async function ImportPage() {
  await requirePermission("users.import", "/admin/usuarios/importar");
  return (
    <>
      <Link href="/admin/usuarios" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Usuarios</Link>
      <PageHeader title="Importar usuarios" description="Sube la plantilla llena. Primero se valida todo y solo después se crean los usuarios válidos." />
      <ImportWizard />
    </>
  );
}
