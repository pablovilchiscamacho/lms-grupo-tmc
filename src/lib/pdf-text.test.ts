import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { pdfSafe } from "./pdf-text";

describe("pdfSafe", () => {
  it("conserva el español y cambia lo que la fuente no puede dibujar, sin romper el PDF", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    expect(pdfSafe(font, "Ñandú · ¿Qué tal? «sí»")).toBe("Ñandú · ¿Qué tal? «sí»");
    expect(pdfSafe(font, "Perro → Ladra")).toBe("Perro -> Ladra");
    expect(pdfSafe(font, "Listo ✓ 🚚")).toBe("Listo v ?");
  });
});
