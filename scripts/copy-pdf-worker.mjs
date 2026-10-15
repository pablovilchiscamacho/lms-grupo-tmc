// Copia el worker de pdf.js a /public para que el visor de PDF lo cargue desde el mismo dominio (CSP 'self').
import { copyFileSync, existsSync } from "node:fs";
// Versión «legacy»: funciona también en celulares con navegador viejo (Chrome/Safari de hace años).
const src = "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";
if (existsSync(src)) copyFileSync(src, "public/pdf.worker.min.mjs");
