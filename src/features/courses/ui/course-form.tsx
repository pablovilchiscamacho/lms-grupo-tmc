"use client";
import Link from "next/link";
import { useActionState } from "react";
import type { ActionResult } from "@/lib/action";
import { Alert, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";

export type CourseFormValues = {
  code?: string; title?: string; description?: string | null; owner_company_id?: string | null; default_requirement?: string;
  estimated_minutes?: number | null; issues_certificate?: boolean; validity_months?: number | null;
};

export function CourseForm({ action, initial = {}, companies, mode, allowGroup = true }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>; initial?: CourseFormValues;
  companies: { id: string; name: string }[]; mode: "create" | "edit";
  /** false: quien administra una sola empresa no ve «Todo el grupo». */
  allowGroup?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const fe = state && !state.ok ? state.error.fieldErrors ?? {} : {};
  const inp = (n: string) => ({ id: n, name: n, "aria-invalid": !!fe[n] });
  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state && !state.ok && <Alert kind="error">{state.error.message}</Alert>}
      {state?.ok && state.message && <Alert kind="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <Field label="Clave" htmlFor="code" error={fe.code} hint={mode === "create" ? "Ej. SEG-001. No se puede cambiar después." : undefined} required>
          <input {...inp("code")} defaultValue={initial.code} className="input uppercase" disabled={mode === "edit"} required />
        </Field>
        <Field label="Nombre del curso" htmlFor="title" error={fe.title} required>
          <input {...inp("title")} defaultValue={initial.title} className="input" placeholder="Ej. Seguridad Operativa" required />
        </Field>
      </div>
      {mode === "edit" && <input type="hidden" name="code" value={initial.code} />}
      <Field label="Descripción (la ven los empleados)" htmlFor="description" error={fe.description}>
        <textarea {...inp("description")} defaultValue={initial.description ?? ""} rows={3} className="input" placeholder="De qué trata y qué van a aprender." />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="¿De qué empresa es?" htmlFor="owner_company_id" error={fe.owner_company_id} hint="«Todo el grupo» lo pueden usar todas las empresas.">
          <select {...inp("owner_company_id")} defaultValue={initial.owner_company_id ?? (allowGroup ? "" : companies[0]?.id ?? "")} className="input" disabled={mode === "edit"}>
            {allowGroup && <option value="">Todo el grupo</option>}
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Tipo" htmlFor="default_requirement">
          <select {...inp("default_requirement")} defaultValue={initial.default_requirement ?? "mandatory"} className="input">
            <option value="mandatory">Obligatorio</option>
            <option value="recommended">Recomendado</option>
            <option value="optional">Opcional</option>
          </select>
        </Field>
        <Field label="Duración aproximada (minutos)" htmlFor="estimated_minutes" error={fe.estimated_minutes}>
          <input {...inp("estimated_minutes")} defaultValue={initial.estimated_minutes ?? ""} type="number" min={1} className="input" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-1">
          <input type="checkbox" name="issues_certificate" defaultChecked={initial.issues_certificate ?? true} className="size-4" /> Da certificado al terminar
        </label>
        <Field label="Vigencia (meses, opcional)" htmlFor="validity_months" error={fe.validity_months} hint="Para cursos que se renuevan, por ejemplo 12.">
          <input {...inp("validity_months")} defaultValue={initial.validity_months ?? ""} type="number" min={1} max={120} className="input" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        {mode === "create" && <Link href="/admin/cursos" className="btn-ghost">Cancelar</Link>}
        <SubmitButton pendingText="Guardando…">{mode === "create" ? "Crear y seguir al contenido →" : "Guardar datos"}</SubmitButton>
      </div>
    </form>
  );
}
