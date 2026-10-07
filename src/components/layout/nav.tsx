"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useState } from "react";
import {
  Award, BarChart3, BookOpen, Building2, CheckCircle2, ClipboardCheck, ClipboardList, Cog, FileQuestion, Home,
  Bell, LayoutDashboard, ListChecks, Menu, PlayCircle, ScrollText, ShieldCheck, User, Users, X, Gauge,
} from "lucide-react";

const ICONS = {
  home: Home, book: BookOpen, play: PlayCircle, check: CheckCircle2, award: Award, user: User, bell: Bell,
  dashboard: LayoutDashboard, users: Users, building: Building2, courses: BookOpen, exams: ClipboardList,
  questions: FileQuestion, assign: ListChecks, grading: ClipboardCheck, reports: BarChart3, audit: ScrollText,
  settings: Cog, shield: ShieldCheck, gauge: Gauge,
};
export type IconName = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: IconName; phase?: number; exact?: boolean };

const isActive = (pathname: string, item: NavItem) =>
  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");

/** Navegación del empleado: barra superior en escritorio, barra inferior en el celular. */
export function EmployeeNav({ items, badges = {} }: { items: NavItem[]; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const mobile = items.filter((i) => ["/", "/cursos", "/certificados", "/notificaciones", "/perfil"].includes(i.href));
  return (
    <>
      <nav aria-label="Principal" className="hidden gap-0.5 xl:flex">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
              className={clsx("flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap transition",
                active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
              <Icon className="size-4" aria-hidden /> {item.label}
              {badges[item.href] ? <span className="rounded-full bg-brand-700 px-1.5 text-[10px] font-semibold text-white">{badges[item.href]}</span> : null}
            </Link>
          );
        })}
      </nav>
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] xl:hidden">
        {mobile.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
              className={clsx("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-brand-800" : "text-slate-500")}>
              <Icon className="size-5" aria-hidden /> {item.label}
              {badges[item.href] ? <span className="absolute top-1 left-1/2 ml-1.5 rounded-full bg-brand-700 px-1.5 text-[10px] font-semibold text-white" aria-label={`${badges[item.href]} sin leer`}>{badges[item.href]}</span> : null}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export type NavSection = { title?: string; items: NavItem[] };

/** Menú lateral del administrador (se filtra por permisos en el servidor antes de llegar aquí). */
export function AdminSidebar({ sections, footer }: { sections: NavSection[]; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const content = (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {sections.map((s, i) => (
          <div key={i}>
            {s.title && <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-brand-300 uppercase">{s.title}</p>}
            <ul className="space-y-0.5">
              {s.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item);
                if (item.phase) {
                  return (
                    <li key={item.href}>
                      <span className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-brand-300/60" title={`Disponible en la Fase ${item.phase}`}>
                        <Icon className="size-4" aria-hidden /> <span className="flex-1">{item.label}</span>
                        <span className="rounded bg-white/5 px-1.5 text-[10px]">F{item.phase}</span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link href={item.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                      className={clsx("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition",
                        active ? "bg-white/10 font-medium text-white" : "text-brand-100 hover:bg-white/5 hover:text-white")}>
                      <Icon className="size-4" aria-hidden /> {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {footer && <div className="border-t border-white/10 p-3">{footer}</div>}
    </div>
  );
  return (
    <>
      <button className="btn-ghost p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
        <Menu className="size-5" />
      </button>
      <aside className="fixed inset-y-0 left-0 top-14 z-20 hidden w-60 bg-brand-900 lg:block">{content}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-brand-900">
            <div className="flex justify-end p-2">
              <button className="rounded-lg p-2 text-white hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X className="size-5" /></button>
            </div>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
