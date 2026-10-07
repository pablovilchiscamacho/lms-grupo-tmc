import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Company = { id: string; name: string; short_name: string; legal_name: string | null; rfc: string | null; timezone: string; is_active: boolean };
export type Branch = { id: string; company_id: string; name: string; code: string; city: string | null; state: string | null; is_active: boolean };
export type Department = { id: string; company_id: string; parent_id: string | null; name: string; code: string; functional_area: string | null; is_active: boolean };
export type Position = { id: string; company_id: string; department_id: string | null; name: string; code: string; is_active: boolean };
export type OrgOptions = { companies: Company[]; branches: Branch[]; departments: Department[]; positions: Position[] };

/** Catálogos de organización visibles para el usuario (RLS limita a sus empresas). */
export async function getOrgOptions(opts: { includeInactive?: boolean } = {}): Promise<OrgOptions> {
  const supabase = await createClient();
  const q = (table: string, cols: string) => {
    const base = supabase.from(table).select(cols);
    return (opts.includeInactive ? base : base.eq("is_active", true)).order("name");
  };
  const [c, b, d, p] = await Promise.all([
    q("companies", "id, name, short_name, legal_name, rfc, timezone, is_active"),
    q("branches", "id, company_id, name, code, city, state, is_active"),
    q("departments", "id, company_id, parent_id, name, code, functional_area, is_active"),
    q("positions", "id, company_id, department_id, name, code, is_active"),
  ]);
  for (const r of [c, b, d, p]) if (r.error) throw r.error;
  return {
    companies: (c.data ?? []) as unknown as Company[],
    branches: (b.data ?? []) as unknown as Branch[],
    departments: (d.data ?? []) as unknown as Department[],
    positions: (p.data ?? []) as unknown as Position[],
  };
}
