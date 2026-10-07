// Copies the PDF.js worker into /public so the in-app PDF reader can load it same-origin.
// Fail-soft: if it's missing, the viewer falls back to the browser's built-in PDF frame.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
const src = "node_modules/pdfjs-dist/build/pdf.worker.min.js";
if (existsSync(src)) {
  mkdirSync("public/pdfjs", { recursive: true });
  copyFileSync(src, "public/pdfjs/pdf.worker.min.js");
  console.log("pdf.js worker copied to public/pdfjs/");
} else console.log("pdfjs-dist not installed yet — skipping worker copy");
