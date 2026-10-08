import type { PDFFont } from "pdf-lib";

const REPLACE: Record<string, string> = { "→": "->", "←": "<-", "✓": "v", "✔": "v", "✗": "x", "•": "·", " ": " ", " ": " ", "​": "" };

/**
 * Las fuentes estándar de PDF solo tienen WinAnsi (español completo, pero no flechas ni emojis).
 * Reemplaza lo conocido, quita acentos que no existan y deja «?» en lo imposible, en lugar de romper el PDF.
 */
export function pdfSafe(font: PDFFont, s: string) {
  const enc = (t: string) => { try { font.encodeText(t); return true; } catch { return false; } };
  if (enc(s)) return s;
  return [...s].map((ch) => {
    if (enc(ch)) return ch;
    const r = REPLACE[ch];
    if (r !== undefined) return r;
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return base && enc(base) ? base : "?";
  }).join("");
}
