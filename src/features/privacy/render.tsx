import type { ReactNode } from "react";

/** Texto del aviso: «## Título» = subtítulo, «- algo» = viñeta, líneas en blanco separan párrafos. Sin HTML. */
export function PrivacyText({ body }: { body: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`} className="list-disc space-y-1 pl-6">{list.map((l, i) => <li key={i}>{l}</li>)}</ul>); list = []; } };
  for (const block of body.replace(/\r/g, "").split(/\n{2,}/)) {
    for (const line of block.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("- ")) { list.push(t.slice(2)); continue; }
      flush();
      if (t.startsWith("## ")) out.push(<h2 key={`h${out.length}`} className="pt-2 text-base font-semibold text-slate-900">{t.slice(3)}</h2>);
      else out.push(<p key={`p${out.length}`}>{t}</p>);
    }
    flush();
  }
  return <div className="space-y-3 text-sm leading-relaxed text-slate-700">{out}</div>;
}
