import { readFile } from "node:fs/promises";
import { DocumentLoader, type Document } from "../types.js";

type PdfTextItem = { str: string };
type PdfPage = { getTextContent: () => Promise<{ items: PdfTextItem[] }> };
type PdfDocument = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfjsLib = { getDocument: (opts: { data: Uint8Array }) => { promise: Promise<PdfDocument> } };

export class PdfLoader extends DocumentLoader {
  supports(ext: string): boolean {
    return ext.toLowerCase() === ".pdf";
  }

  async load(source: string): Promise<Document[]> {
    let pdfjsLib: PdfjsLib;
    try {
      const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
      const mod = await import(specifier);
      pdfjsLib = mod as unknown as PdfjsLib;
    } catch {
      throw new Error("PdfLoader requires 'pdfjs-dist'. Install it: pnpm add pdfjs-dist");
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(source);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`PDF loader: failed to read file '${source}': ${msg}`);
    }
    const data = new Uint8Array(fileBuffer);
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => item.str).join(" ");
      pages.push(text);
    }

    return [
      {
        content: pages.join("\n\n"),
        metadata: { type: "pdf", pages: pdf.numPages },
        source,
      },
    ];
  }
}
