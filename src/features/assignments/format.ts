export function audienceLabel(a: { mode: string; company: { short_name: string } | null; branch: { name: string } | null; department: { name: string } | null; position: { name: string } | null; group: { name: string } | null }) {
  if (a.mode === "direct") return "Personas específicas";
  return [a.company?.short_name, a.branch?.name, a.department?.name, a.position?.name, a.group?.name].filter(Boolean).join(" · ");
}
