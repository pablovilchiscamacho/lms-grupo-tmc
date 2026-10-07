import "server-only";
import sanitizeHtml from "sanitize-html";

/** Texto enriquecido de lecciones: lista blanca estricta (sin style, scripts ni eventos). SECURITY.md §9 */
export function sanitizeLessonHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "a", "code", "pre", "hr"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["https", "mailto"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  }).slice(0, 200_000);
}
