export type Ref = { id: string; name: string } | null;

export type SessionContext = {
  profile: {
    id: string;
    first_name: string;
    last_name_paternal: string;
    last_name_maternal: string | null;
    full_name: string;
    email: string | null;
    has_real_email: boolean;
    employee_number: string | null;
    username: string | null;
    phone: string | null;
    status: "active" | "inactive" | "suspended" | "deleted";
    must_change_password: boolean;
    hire_date: string | null;
    last_login_at: string | null;
    created_at: string;
    company: { id: string; name: string; short_name: string; timezone: string };
    branch: Ref;
    department: Ref;
    position: Ref;
    manager: { id: string; full_name: string } | null;
  };
  permissions: string[];
  roles: { key: string; name: string; scope_type: string; scope_id: string | null; requires_mfa: boolean }[];
  requires_mfa: boolean;
  aal: "aal1" | "aal2";
};
