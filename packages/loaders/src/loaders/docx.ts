import { DocumentLoader, type Document } from "../types.js";

type MammothLib = { extractRawText: (opts: { path: string }) => Promise<{ value: string }> };

export class DocxLoader extends DocumentLoader {
  supports(ext: string): boolean {
    return ext.toLowerCase() === ".docx";
  }

  async load(source: string): Promise<Document[]> {
    let mammoth: MammothLib;
    try {
      const specifier = "mammoth";
      const mod = await import(specifier);
      mammoth = mod as unknown as MammothLib;
    } catch {
      throw new Error("DocxLoader requires 'mammoth'. Install it: pnpm add mammoth");
    }

    const result = await mammoth.extractRawText({ path: source });
    return [{ content: result.value, metadata: { type: "docx" }, source }];
  }
}
