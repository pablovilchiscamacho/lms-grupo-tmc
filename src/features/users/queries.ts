import "server-only";
import { createClient } from "@/lib/supabase/server";
import { norm } from "@/lib/format";

export const PAGE_SIZE = 25;

export type UserListRow = {
  id: string; full_name: string; employee_number: string | null; email: string | null; username: string | null;
  status: string; last_login_at: string | null;
  company: { short_name: string } | null; branch: { name: string } | null;
  department: { name: string } | null; position: { name: string } | null;
};

export type UserFilters = {
  q?: string; company?: string; branch?: string; department?: string; position?: string;
  status?: string; role?: string; sin?: string; page?: number;
};

const LIST_COLUMNS = `id, full_name, employee_number, email, username, status, last_login_at,
  company:companies!profiles_company_id_fkey(short_name),
  branch:branches!profiles_branch_id_fkey(name),
  department:departments!profiles_department_id_fkey(name),
  position:positions!profiles_position_id_fkey(name)`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const isUuid = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

/** Lista paginada en el servidor; RLS limita a los usuarios dentro del alcance del administrador. */
export async function listUsers(f: UserFilters) {
  const supabase = await createClient();
  const page = Math.max(1, f.page ?? 1);
  let roleId: string | null = null;
  if (f.role) {
    const { data } = await supabase.from("roles").select("id").eq("key", f.role).maybeSingle();
    roleId = data?.id ?? "00000000-0000-0000-0000-000000000000";
  }
  const cols = roleId ? `${LIST_COLUMNS}, ur:user_roles!user_roles_user_id_fkey!inner(role_id, revoked_at)` : LIST_COLUMNS;
  let query = supabase.from("profiles").select(cols, { count: "exact" });

  if (f.q?.trim()) query = query.ilike("search", `%${escapeLike(norm(f.q))}%`);
  if (isUuid(f.company)) query = query.eq("company_id", f.company!);
  if (isUuid(f.branch)) query = query.eq("branch_id", f.branch!);
  if (isUuid(f.department)) query = query.eq("department_id", f.department!);
  if (isUuid(f.position)) query = query.eq("position_id", f.position!);
  if (f.status && ["active", "inactive", "suspended", "deleted"].includes(f.status)) query = query.eq("status", f.status);
  else query = query.neq("status", "deleted");
  if (f.sin === "departamento") query = query.is("department_id", null);
  if (f.sin === "jefe") query = query.is("manager_id", null);
  if (roleId) query = query.eq("ur.role_id", roleId).is("ur.revoked_at", null);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("last_name_paternal").order("first_name").order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as unknown as UserListRow[], total: count ?? 0, page };
}

export type UserDetail = {
  id: string; first_name: string; last_name_paternal: string; last_name_maternal: string | null; full_name: string;
  email: string | null; auth_email: string; has_real_email: boolean; employee_number: string | null; username: string | null;
  phone: string | null; company_id: string; branch_id: string | null; department_id: string | null; position_id: string | null;
  manager_id: string | null; hire_date: string | null; status: string; status_reason: string | null; status_changed_at: string | null;
  must_change_password: boolean; last_login_at: string | null; created_at: string; updated_at: string;
  company: { name: string; timezone: string } | null; branch: { name: string } | null; department: { name: string } | null;
  position: { name: string } | null; manager: { id: string; full_name: string } | null;
};

export type UserRoleRow = {
  id: string; scope_type: string; scope_id: string | null; granted_at: string; expires_at: string | null;
  role: { key: string; name: string } | null;
};

export async function getUser(id: string) {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(`*, company:companies!profiles_company_id_fkey(name, timezone), branch:branches!profiles_branch_id_fkey(name),
      department:departments!profiles_department_id_fkey(name), position:positions!profiles_position_id_fkey(name),
      manager:profiles!profiles_manager_id_fkey(id, full_name)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const roles = await supabase
    .from("user_roles")
    .select("id, scope_type, scope_id, granted_at, expires_at, role:roles(key, name)")
    .eq("user_id", id)
    .is("revoked_at", null)
    .order("granted_at");
  return { user: data as unknown as UserDetail, roles: (roles.data ?? []) as unknown as UserRoleRow[] };
}

export async function listRoles() {
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("key, name, description").order("name");
  return data ?? [];
}
