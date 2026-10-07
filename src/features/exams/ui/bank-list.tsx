"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, EmptyState } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { deleteQuestion } from "../actions";
import { DIFFICULTY, SHORT_TYPE, type QuestionInput, type QuestionRow } from "../types";
import { fromRow, QuestionEditor } from "./question-editor";
import { ImportQuestions } from "./exam-builder";

export function BankList({ rows, categories, canWrite }: { rows: QuestionRow[]; categories: { id: string; name: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "new" | "import" | { edit: QuestionInput; locked: boolean }>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = () => { setModal(null); router.refresh(); };
  return (
    <>
      {canWrite && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setModal("new")}><Plus className="size-4" /> Nueva pregunta</button>
          <button className="btn-secondary" onClick={() => setModal("import")}><FileSpreadsheet className="size-4" /> Importar desde Excel</button>
        </div>
      )}
      {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
      {rows.length === 0 ? <EmptyState title="No hay preguntas con ese filtro">Crea preguntas aquí o directamente dentro del examen de un curso.</EmptyState> : (
        <div className="card divide-y divide-slate-100">
          {rows.map((q) => (
            <div key={q.id} className="flex flex-wrap items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">{q.prompt}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <Badge tone="blue">{SHORT_TYPE[q.type]}</Badge> {DIFFICULTY[q.difficulty]} · {Number(q.default_points)} pts
                  {q.topic && <> · {q.topic}</>}{q.category_id && <> · {categories.find((c) => c.id === q.category_id)?.name}</>}
                  {q.revision > 1 && <> · revisión {q.revision}</>}
                  {q.is_locked && <span className="inline-flex items-center gap-0.5" title="Ya se usó: editarla crea una revisión"><Lock className="size-3" /> en uso</span>}
                </p>
              </div>
              {canWrite && (
                <div className="flex gap-1">
                  <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => setModal({ edit: fromRow(q), locked: q.is_locked })} aria-label="Editar"><Pencil className="size-4" /></button>
                  <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" disabled={pending} aria-label="Borrar"
                    onClick={() => confirm("¿Borrar la pregunta del banco? Lo ya presentado se conserva en el historial.") && start(async () => { const r = await deleteQuestion(q.id); setError(r.ok ? null : r.error.message); router.refresh(); })}>
                    <Trash2 className="size-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal open={modal !== null} onOpenChange={(o) => !o && setModal(null)} wide title={modal === "new" ? "Nueva pregunta" : modal === "import" ? "Importar preguntas desde Excel" : "Editar pregunta"}>
        {modal === "new" && <QuestionEditor categories={categories} onSaved={done} onCancel={() => setModal(null)} />}
        {modal && typeof modal === "object" && <QuestionEditor initial={modal.edit} locked={modal.locked} categories={categories} onSaved={done} onCancel={() => setModal(null)} />}
        {modal === "import" && <ImportQuestions examId={null} defaultCategory="General" onDone={done} />}
      </Modal>
    </>
  );
}
