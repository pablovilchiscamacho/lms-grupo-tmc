"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Loader2, Quote } from "lucide-react";
import { saveTextContent } from "@/features/content/actions";

/** Editor sencillo para lecciones de texto. El HTML se limpia en el servidor antes de guardarse. */
export function TextEditor({ contentId, html, readOnly }: { contentId: string; html: string; readOnly?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false, protocols: ["https"], HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } })],
    content: html,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: { attributes: { class: "lesson-html min-h-40 rounded-b-lg border border-t-0 border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" } },
  });
  if (!editor) return null;
  const btn = (active: boolean, onClick: () => void, label: string, Icon: typeof Bold) => (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active}
      className={clsx("rounded p-1.5", active ? "bg-brand-100 text-brand-800" : "text-slate-600 hover:bg-slate-100")}>
      <Icon className="size-4" />
    </button>
  );
  return (
    <div>
      {!readOnly && (
        <div className="flex flex-wrap gap-0.5 rounded-t-lg border border-slate-300 bg-slate-50 px-1 py-1">
          {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Negritas", Bold)}
          {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Cursivas", Italic)}
          {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Subtítulo", Heading2)}
          {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Lista", List)}
          {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Lista numerada", ListOrdered)}
          {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "Cita", Quote)}
          {btn(editor.isActive("link"), () => {
            const prev = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("Dirección del enlace (https://…)", prev ?? "https://");
            if (url === null) return;
            if (url === "" || url === "https://") editor.chain().focus().unsetLink().run();
            else if (url.startsWith("https://")) editor.chain().focus().setLink({ href: url }).run();
          }, "Enlace", Link2)}
        </div>
      )}
      <EditorContent editor={editor} />
      {!readOnly && (
        <div className="mt-2 flex items-center justify-end gap-3">
          {msg && <span className="text-xs text-slate-500" role="status">{msg}</span>}
          <button type="button" className="btn-secondary" disabled={pending}
            onClick={() => start(async () => { const r = await saveTextContent(contentId, editor.getHTML()); setMsg(r.ok ? "Guardado" : r.error.message); })}>
            {pending && <Loader2 className="size-4 animate-spin" />} Guardar texto
          </button>
        </div>
      )}
    </div>
  );
}
