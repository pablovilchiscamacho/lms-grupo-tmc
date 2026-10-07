export const IMPORT_FIELDS = [
  "nombre", "apellido_paterno", "apellido_materno", "email", "numero_empleado", "usuario",
  "empresa", "sucursal", "departamento", "puesto", "jefe", "telefono", "fecha_ingreso",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type RawRow = Partial<Record<ImportField, string>>;
export type CheckedRow = {
  row: number; status: "valid" | "error" | "duplicate"; errors: string[]; raw: RawRow;
  data: Record<string, unknown>; manager_ref: string | null;
};
export type ImportOutcome = {
  row: number; ok: boolean; id?: string; name: string; login?: string; tempPassword?: string; invited?: boolean;
  error?: string; manager_ref?: string | null;
};
export const FIELD_TITLES: Record<ImportField, string> = {
  nombre: "Nombre", apellido_paterno: "Apellido paterno", apellido_materno: "Apellido materno", email: "Email",
  numero_empleado: "Número de empleado", usuario: "Usuario", empresa: "Empresa", sucursal: "Sucursal",
  departamento: "Departamento", puesto: "Puesto", jefe: "Jefe", telefono: "Teléfono", fecha_ingreso: "Fecha de ingreso",
};
