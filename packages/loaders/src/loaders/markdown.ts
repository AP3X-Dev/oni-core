import { readFile } from "node:fs/promises";
import { DocumentLoader, type Document } from "../types.js";

export class MarkdownLoader extends DocumentLoader {
  supports(ext: string): boolean {
    return [".md", ".mdx", ".markdown"].includes(ext.toLowerCase());
  }

  async load(source: string): Promise<Document[]> {
    const content = await readFile(source, "utf-8");
    return [{ content, metadata: { type: "markdown" }, source }];
  }
}
