import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { cellText, parseQuestionRows } from "./import-parse";

async function grid(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const g: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(r.getCell(c).value));
    g.push(vals);
  });
  return g;
}

describe("Importación de preguntas (plantilla oficial)", () => {
  it("lee los 8 tipos de la plantilla sin errores", async () => {
    const rows = parseQuestionRows(await grid("public/plantillas/preguntas.xlsx"));
    expect(rows.map((r) => r.error)).toEqual(Array(8).fill(null));
    const [single, multi, tf, short, order, match, open, scale] = rows.map((r) => r.question!);
    expect(single.options!.filter((o) => o.is_correct).map((o) => o.text)).toEqual(["Chaleco reflejante"]);
    expect(multi).toMatchObject({ type: "multiple_choice", scoring: "partial" });
    expect(multi.options!.filter((o) => o.is_correct)).toHaveLength(3);
    expect(tf).toMatchObject({ type: "true_false", tf_answer: false });
    expect(short.config).toEqual({ accepted: ["Querétaro", "Queretaro"] });
    expect(order.options!.map((o) => o.text)).toEqual(["Revisar documentos", "Inspeccionar la unidad", "Registrar en el sistema"]);
    expect(match.options![0]).toEqual({ text: "CNTR", match_target: "Contenedor" });
    expect(open).toMatchObject({ type: "open_text", default_points: 20, difficulty: "hard" });
    expect(scale.type).toBe("scale");
  });

  it("marca los errores por fila", () => {
    const rows = parseQuestionRows([
      ["Tipo", "Pregunta", "Opción A", "Opción B", "Correcta"],
      ["Opción múltiple", "¿Sin correcta?", "uno", "dos", ""],
      ["Inventado", "¿Tipo raro?", "", "", ""],
      ["Verdadero/Falso", "¿Sin respuesta?", "", "", ""],
    ]);
    expect(rows.map((r) => r.error)).toEqual(["Marca exactamente una respuesta correcta.", "Tipo «Inventado» no reconocido.", "Indica si es Verdadero o Falso."]);
  });
});
