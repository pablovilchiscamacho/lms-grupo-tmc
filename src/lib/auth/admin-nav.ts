import type { NavSection } from "@/components/layout/nav";
import type { SessionContext } from "@/types/context";
import { canAny } from "./session";

type Def = { href: string; label: string; icon: NavSection["items"][number]["icon"]; perms: string[]; phase?: number; exact?: boolean };

/** Menú de administración (§35). Solo aparece lo que el usuario puede usar; lo que aún no existe se marca con su fase. */
const DEFS: { title?: string; items: Def[] }[] = [
  { items: [
    { href: "/admin", label: "Dashboard", icon: "dashboard", perms: ["*"], exact: true },
    { href: "/admin/direccion", label: "Dirección", icon: "gauge", perms: ["dashboard.executive"], phase: 5 },
    { href: "/admin/cumplimiento", label: "Cumplimiento", icon: "shield", perms: ["progress.read"], phase: 5 },
  ] },
  { title: "Personas", items: [
    { href: "/admin/usuarios", label: "Usuarios", icon: "users", perms: ["users.read"] },
    { href: "/admin/organizacion", label: "Organización", icon: "building", perms: ["org.read", "org.manage"] },
  ] },
  { title: "Capacitación", items: [
    { href: "/admin/cursos", label: "Cursos", icon: "courses", perms: ["courses.read"] },
    { href: "/admin/banco-preguntas", label: "Banco de preguntas", icon: "questions", perms: ["questions.read"], phase: 3 },
    { href: "/admin/examenes", label: "Exámenes", icon: "exams", perms: ["exams.write"], phase: 3 },
    { href: "/admin/asignaciones", label: "Asignaciones", icon: "assign", perms: ["assignments.read"], phase: 4 },
    { href: "/admin/calificaciones", label: "Calificaciones", icon: "grading", perms: ["grading.grade"], phase: 3 },
    { href: "/admin/certificados", label: "Certificados", icon: "award", perms: ["certificates.read"], phase: 6 },
  ] },
  { title: "Control", items: [
    { href: "/admin/reportes", label: "Reportes", icon: "reports", perms: ["reports.read"], phase: 7 },
    { href: "/admin/notificaciones", label: "Notificaciones", icon: "bell", perms: ["notifications.manage"], phase: 8 },
    { href: "/admin/auditoria", label: "Auditoría", icon: "audit", perms: ["audit.read"] },
    { href: "/admin/configuracion", label: "Configuración", icon: "settings", perms: ["settings.manage"], phase: 9 },
  ] },
];

export function adminNav(ctx: SessionContext): NavSection[] {
  return DEFS.map((s) => ({
    title: s.title,
    items: s.items
      .filter((i) => i.perms.includes("*") || canAny(ctx, i.perms))
      .map(({ href, label, icon, phase, exact }) => ({ href, label, icon, phase, exact })),
  })).filter((s) => s.items.length > 0);
}
