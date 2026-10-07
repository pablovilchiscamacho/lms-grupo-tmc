import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { getOrgOptions } from "@/features/org/queries";
import { createUser } from "@/features/users/actions";
import { NewUserForm } from "@/features/users/user-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Nuevo usuario" };

export default async function NewUserPage() {
  await requirePermission("users.create", "/admin/usuarios/nuevo");
  const org = await getOrgOptions();
  return (
    <>
      <PageHeader title="Nuevo usuario" description="Los roles administrativos se asignan después, desde la ficha del usuario." />
      <Card><NewUserForm org={org} action={createUser} /></Card>
    </>
  );
}
