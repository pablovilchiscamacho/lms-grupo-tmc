"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { setAssignmentActive } from "../actions";

export function AssignmentToggle({ id, active, future }: { id: string; active: boolean; future: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!future && active) return null;
  return (
    <button className="btn-secondary" disabled={pending} onClick={() => start(async () => { await setAssignmentActive(id, !active); router.refresh(); })}
      title={active ? "Deja de asignar el curso a quienes entren después. Lo ya asignado se conserva." : undefined}>
      {active ? <><Pause className="size-4" /> Pausar asignación automática</> : <><Play className="size-4" /> Reactivar</>}
    </button>
  );
}
