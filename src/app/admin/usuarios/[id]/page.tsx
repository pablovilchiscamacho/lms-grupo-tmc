import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getUser, listRoles } from "@/features/users/queries";
import { getOrgOptions } from "@/features/org/queries";
import { updateUser } from "@/features/users/actions";
import { UserForm } from "@/features/users/user-form";
import { AccessPanel, RolesPanel, StatusPanel } from "@/features/users/user-admin-panels";
import { AuditList, type AuditEntry } from "@/components/audit-list";
import { enrollmentsFor, examsByVersion } from "@/features/assignments/queries";
import { EnrollmentTable } from "@/features/assignments/ui/enrollment-table";
import { fmtDate, fmtDateTime, STATUS_LABEL } from "@/lib/format";
import { Alert, Avatar, Badge, Card, STATUS_TONE } from "@/components/ui";

export const metadata: Metadata = { title: "Usuario" };

export default async function UserDetailPage({ params }: PageProps<"/admin/usuarios/[id]">) {
  const { id } = await params;
  const ctx = await requirePermission("users.read", `/admin/usuarios/${id}`);
  const found = await getUser(id);
  if (!found) notFound();
  const { user: u, roles } = found;
  const [org, allRoles] = await Promise.all([getOrgOptions(), listRoles()]);
  const tz = u.company?.timezone;
  const isSelf = u.id === ctx.profile.id;

  let history: AuditEntry[] = [];
  if (can(ctx, "audit.read")) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("search_audit", { p_entity_id: u.id, p_limit: 30 });
    history = (data ?? []) as AuditEntry[];
  }
  const editable = can(ctx, "users.update") && u.status !== "deleted";
  const training = await enrollmentsFor({ user: u.id });
  const trainingExams = await examsByVersion(training.map((t) => t.course_version_id ?? ""));

  return (
    <>
      <Link href="/admin/usuarios" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Usuarios</Link>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={u.full_name} size={52} />
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-slate-900">{u.full_name}</h1>
          <p className="text-sm text-slate-500">{[u.position?.name, u.department?.name, u.company?.name].filter(Boolean).join(" · ")}</p>
        </div>
        <Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge>
      </div>
      {u.status !== "active" && u.status_reason && (
        <div className="mb-4"><Alert kind="warning" title={`${STATUS_LABEL[u.status]} desde ${fmtDate(u.status_changed_at, tz)}`}>{u.status_reason}</Alert></div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Datos del usuario">
            {editable ? (
              <UserForm org={org} mode="edit" action={updateUser.bind(null, u.id)} initial={{ ...u, manager: u.manager }} />
            ) : (
              <p className="text-sm text-slate-500">Solo lectura.</p>
            )}
          </Card>
          <Card title="Historial de capacitación">
            <EnrollmentTable rows={training} exams={trainingExams} canAdjust={can(ctx, "enrollments.adjust")} revalidate={`/admin/usuarios/${u.id}`} show={{ course: true }} />
          </Card>
          {can(ctx, "audit.read") && (
            <Card title="Historial de cambios">
              {history.length ? <AuditList entries={history} tz={tz} /> : <p className="text-sm text-slate-500">Sin eventos.</p>}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Resumen">
            <dl className="space-y-2 text-sm">
              <Row k="Último acceso" v={u.last_login_at ? fmtDateTime(u.last_login_at, tz) : "Nunca"} />
              <Row k="Alta" v={fmtDate(u.created_at, tz)} />
              <Row k="Acceso con" v={u.has_real_email ? "Correo" : u.username ? `Usuario @${u.username}` : `Núm. ${u.employee_number ?? "—"}`} />
              {u.must_change_password && <Row k="Contraseña" v={<Badge tone="amber">Temporal</Badge>} />}
            </dl>
          </Card>
          <Card title="Roles">
            <RolesPanel userId={u.id} roles={roles} allRoles={allRoles} org={org} canAssign={can(ctx, "roles.assign") && !isSelf && u.status === "active"} />
          </Card>
          {can(ctx, "users.update") && !isSelf && (
            <Card title="Acceso"><AccessPanel userId={u.id} hasRealEmail={u.has_real_email} active={u.status === "active"} /></Card>
          )}
          {can(ctx, "users.deactivate") && !isSelf && (
            <Card title="Estado"><StatusPanel userId={u.id} status={u.status} /></Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right text-slate-800">{v}</dd></div>;
}
