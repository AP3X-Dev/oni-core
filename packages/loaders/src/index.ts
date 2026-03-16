export type { Document } from "./types.js";
export { DocumentLoader } from "./types.js";
export { MarkdownLoader } from "./loaders/markdown.js";
export { JsonLoader } from "./loaders/json.js";
export { CsvLoader } from "./loaders/csv.js";
export { PdfLoader } from "./loaders/pdf.js";
export { HtmlLoader } from "./loaders/html.js";
export { DocxLoader } from "./loaders/docx.js";

import { DocumentLoader } from "./types.js";
import { MarkdownLoader } from "./loaders/markdown.js";
import { JsonLoader } from "./loaders/json.js";
import { CsvLoader } from "./loaders/csv.js";
import { PdfLoader } from "./loaders/pdf.js";
import { HtmlLoader } from "./loaders/html.js";
import { DocxLoader } from "./loaders/docx.js";

/** Convenience: get the right loader for a file path */
export function getLoader(filePath: string): DocumentLoader | null {
  const dotIdx = filePath.lastIndexOf(".");
  const ext = dotIdx >= 0 ? filePath.slice(dotIdx) : "";
  const loaders = [
    new MarkdownLoader(),
    new JsonLoader(),
    new CsvLoader(),
    new PdfLoader(),
    new HtmlLoader(),
    new DocxLoader(),
  ];
  return loaders.find((l) => l.supports(ext)) ?? null;
}
