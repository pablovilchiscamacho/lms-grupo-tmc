import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { BrandMark } from "@/components/ui";
import { EmployeeNav, type NavItem } from "@/components/layout/nav";
import { UserMenu } from "@/components/layout/user-menu";

const ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", icon: "home", exact: true },
  { href: "/cursos", label: "Mis cursos", icon: "book" },
  { href: "/en-progreso", label: "En progreso", icon: "play" },
  { href: "/completados", label: "Completados", icon: "check" },
  { href: "/certificados", label: "Certificados", icon: "award" },
  { href: "/notificaciones", label: "Avisos", icon: "bell" },
  { href: "/perfil", label: "Perfil", icon: "user" },
];

export default async function EmployeeLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireUser();
  const isAdmin = ctx.permissions.length > 0 || ctx.requires_mfa;
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="text-brand-900"><BrandMark /></Link>
          <EmployeeNav items={ITEMS} />
          <UserMenu name={ctx.profile.full_name} subtitle={ctx.profile.company.short_name} adminLink={isAdmin} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
