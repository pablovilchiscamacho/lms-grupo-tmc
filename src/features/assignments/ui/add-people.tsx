"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { Alert, Card } from "@/components/ui";
import { addToAssignment } from "../actions";
import { PeoplePicker } from "./assignment-wizard";

type Person = { id: string; full_name: string; employee_number: string | null };

/** Agregar personas a una asignación de «personas específicas» (sin crear otra asignación). */
export function AddPeople({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button className="btn-secondary" onClick={() => { setOpen(true); setMsg(null); }}><UserPlus className="size-4" /> Agregar personas</button>;
  return (
    <Card title="Agregar personas a esta asignación">
      <div className="space-y-3">
        {msg && <Alert kind={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
        <PeoplePicker people={people} setPeople={setPeople} />
        <div className="flex gap-2">
          <button className="btn-primary" disabled={!people.length || pending} onClick={() => start(async () => {
            const r = await addToAssignment(assignmentId, people.map((p) => p.id));
            if (!r.ok) return setMsg({ ok: false, text: r.error.message });
            setMsg({ ok: true, text: `Se agregaron ${r.data!.created}${r.data!.skipped ? `; ${r.data!.skipped} ya tenían el curso` : ""}.` });
            setPeople([]);
            router.refresh();
          })}>{pending && <Loader2 className="size-4 animate-spin" />} Agregar {people.length || ""}</button>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cerrar</button>
        </div>
      </div>
    </Card>
  );
}
