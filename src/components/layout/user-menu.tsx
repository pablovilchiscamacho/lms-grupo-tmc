"use client";
import Link from "next/link";
import { DropdownMenu as M } from "radix-ui";
import { ChevronDown, LogOut, User, LayoutDashboard, GraduationCap } from "lucide-react";
import { Avatar } from "@/components/ui";

export function UserMenu({ name, subtitle, adminLink, employeeLink }: { name: string; subtitle: string; adminLink?: boolean; employeeLink?: boolean }) {
  return (
    <M.Root>
      <M.Trigger className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-100" aria-label="Menú de usuario">
        <Avatar name={name} size={32} />
        <span className="hidden sm:block">
          <span className="block text-sm font-medium leading-tight text-slate-800">{name}</span>
          <span className="block text-xs leading-tight text-slate-500">{subtitle}</span>
        </span>
        <ChevronDown className="size-4 text-slate-400" aria-hidden />
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
          <M.Item asChild><Link href="/perfil" className="flex items-center gap-2 rounded-md px-2.5 py-2 outline-none data-highlighted:bg-slate-100"><User className="size-4" /> Mi perfil</Link></M.Item>
          {employeeLink && <M.Item asChild><Link href="/" className="flex items-center gap-2 rounded-md px-2.5 py-2 outline-none data-highlighted:bg-slate-100"><GraduationCap className="size-4" /> Mi capacitación</Link></M.Item>}
          {adminLink && <M.Item asChild><Link href="/admin" className="flex items-center gap-2 rounded-md px-2.5 py-2 outline-none data-highlighted:bg-slate-100"><LayoutDashboard className="size-4" /> Administración</Link></M.Item>}
          <M.Separator className="my-1 h-px bg-slate-100" />
          <M.Item asChild><a href="/salir" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-red-600 outline-none data-highlighted:bg-red-50"><LogOut className="size-4" /> Cerrar sesión</a></M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
