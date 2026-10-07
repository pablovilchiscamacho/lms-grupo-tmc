import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { myNotifications } from "@/features/assignments/queries";
import { MarkAllRead } from "@/features/assignments/ui/mark-read";
import { fmtRelative } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Avisos" };

export default async function NotificationsPage() {
  await requireUser();
  const list = await myNotifications(100);
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <>
      <PageHeader title="Avisos" description={unread ? `${unread} sin leer` : undefined} actions={unread ? <MarkAllRead /> : undefined} />
      {list.length === 0 ? <EmptyState icon={<Bell className="size-8" />} title="No tienes avisos">Aquí verás cursos nuevos, fechas próximas a vencer y tus resultados.</EmptyState> : (
        <ul className="card divide-y divide-slate-100">
          {list.map((n) => {
            const body = (
              <div className="flex items-start gap-3 p-4">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-brand-600"}`} aria-label={n.read_at ? undefined : "Sin leer"} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${n.read_at ? "text-slate-600" : "font-medium text-slate-900"}`}>{n.title}</p>
                  {n.body && <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>}
                  <p className="mt-1 text-xs text-slate-400">{fmtRelative(n.created_at)}</p>
                </div>
              </div>
            );
            return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-slate-50">{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </>
  );
}
