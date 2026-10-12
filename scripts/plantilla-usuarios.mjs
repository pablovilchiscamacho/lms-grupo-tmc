// Genera public/plantillas/usuarios.xlsx (la plantilla que se descarga en Usuarios → Importar).
// La primera hoja es la que lee el importador; las demás solo explican.
//   node scripts/plantilla-usuarios.mjs
import ExcelJS from "exceljs";

const NAVY = "FF1F2A51", LIGHT = "FFE8EEF8";
const COLS = [
  ["Nombre", "Sí", "Nombre(s) de la persona.", "María José"],
  ["Apellido paterno", "Sí", "", "Martínez"],
  ["Apellido materno", "No", "", "López"],
  ["Email", "*", "Correo de la empresa. Si lo tiene, entra con él y le llegan los avisos.", "maria.lopez@atpva.mx"],
  ["Número de empleado", "*", "Solo números o letras, sin espacios. También sirve para entrar.", "1023"],
  ["Usuario", "*", "Solo para quien no tiene correo ni número de empleado (letras, números, punto o guion).", "maria.lopez"],
  ["Empresa", "Sí", "Nombre corto o completo, tal como está en la plataforma.", "ATPVA"],
  ["Sucursal", "No", "Debe existir en Organización.", "Querétaro"],
  ["Departamento", "No", "Debe existir en Organización. Sirve para asignar cursos por área.", "Capital Humano"],
  ["Puesto", "No", "Debe existir en Organización. Sirve para asignar cursos por puesto.", "Analista"],
  ["Jefe", "No", "Número de empleado o correo del jefe directo; puede venir en este mismo archivo.", "1001"],
  ["Teléfono", "No", "10 dígitos, sin espacios.", "4421234567"],
  ["Fecha de ingreso", "No", "dd/mm/aaaa", "15/01/2024"],
];
const TEXT_COLS = [4, 5, 6, 11, 12];   // se guardan como texto para no perder ceros a la izquierda

const wb = new ExcelJS.Workbook();
wb.creator = "Plataforma de capacitación · Grupo TMC";

const ws = wb.addWorksheet("Personal", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = COLS.map(([h], i) => ({ header: h, width: [14, 18, 18, 30, 20, 16, 14, 16, 20, 22, 14, 14, 16][i] }));
ws.getRow(1).height = 22;
ws.getRow(1).eachCell((c, n) => {
  c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  c.alignment = { vertical: "middle" };
  const [, req, help] = COLS[n - 1];
  c.note = `${req === "Sí" ? "Obligatoria. " : req === "*" ? "Pon al menos una: Email, Número de empleado o Usuario. " : "Opcional. "}${help}`;
});
for (const n of TEXT_COLS) ws.getColumn(n).numFmt = "@";
ws.getColumn(13).numFmt = "dd/mm/yyyy";

const ins = wb.addWorksheet("Instrucciones");
ins.columns = [{ width: 22 }, { width: 14 }, { width: 70 }, { width: 24 }];
ins.addRow(["Cómo llenar la plantilla"]).font = { bold: true, size: 14, color: { argb: NAVY } };
for (const t of [
  "1. Captura una persona por renglón en la hoja «Personal», debajo de los títulos. No cambies ni borres los títulos.",
  "2. Cada persona necesita al menos uno de estos tres para poder entrar: Email, Número de empleado o Usuario.",
  "3. Empresa, Sucursal, Departamento y Puesto deben escribirse igual que en la plataforma (Organización).",
  "4. Guarda el archivo como Excel (.xlsx) y súbelo en Usuarios → Importar. Antes de crear a nadie, la plataforma revisa todo y marca los errores.",
]) ins.addRow([t]);
ins.addRow([]);
const head = ins.addRow(["Columna", "¿Obligatoria?", "Qué poner", "Ejemplo"]);
head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; });
COLS.forEach(([h, req, help, ex], i) => {
  const r = ins.addRow([h, req === "*" ? "Una de las tres" : req, help, ex]);
  r.alignment = { vertical: "top", wrapText: true };
  if (i % 2) r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } }; });
});

await wb.xlsx.writeFile("public/plantillas/usuarios.xlsx");
console.log("✓ public/plantillas/usuarios.xlsx");
