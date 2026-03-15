import { readFile } from "node:fs/promises";
import { DocumentLoader, type Document } from "../types.js";

type HtmlElement = { remove(): void };
type HtmlRoot = {
  querySelectorAll: (selector: string) => HtmlElement[];
  structuredText: string;
};
type ParseFn = (html: string) => HtmlRoot;

export class HtmlLoader extends DocumentLoader {
  supports(ext: string): boolean {
    return [".html", ".htm"].includes(ext.toLowerCase());
  }

  async load(source: string): Promise<Document[]> {
    const raw = await readFile(source, "utf-8");

    let parse: ParseFn;
    try {
      const specifier = "node-html-parser";
      const mod = await import(specifier);
      parse = (mod as unknown as { parse: ParseFn }).parse;
    } catch {
      throw new Error(
        "HtmlLoader requires 'node-html-parser'. Install it: pnpm add node-html-parser",
      );
    }

    const parsed = parse(raw);
    for (const el of parsed.querySelectorAll("script, style")) {
      el.remove();
    }

    return [{ content: parsed.structuredText.trim(), metadata: { type: "html" }, source }];
  }
}
