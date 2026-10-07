import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { adminNav } from "@/lib/auth/admin-nav";
import { BrandMark } from "@/components/ui";
import { AdminSidebar } from "@/components/layout/nav";
import { UserMenu } from "@/components/layout/user-menu";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requireAdmin();
  const roleNames = [...new Set(ctx.roles.map((r) => r.name))].join(", ");
  return (
    <div className="min-h-screen">
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 lg:px-4">
        <div className="flex items-center gap-2">
          <AdminSidebar sections={adminNav(ctx)} />
          <Link href="/admin" className="text-brand-900"><BrandMark /></Link>
          <span className="ml-2 hidden rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 sm:inline">Administración</span>
        </div>
        <UserMenu name={ctx.profile.full_name} subtitle={roleNames || ctx.profile.company.short_name} employeeLink />
      </header>
      <main className="px-4 pt-20 pb-10 lg:ml-60 lg:px-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
