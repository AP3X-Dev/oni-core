import { readFile } from "node:fs/promises";
import { DocumentLoader, type Document } from "../types.js";

export class JsonLoader extends DocumentLoader {
  supports(ext: string): boolean {
    return [".json", ".jsonl", ".ndjson"].includes(ext.toLowerCase());
  }

  async load(source: string): Promise<Document[]> {
    const raw = await readFile(source, "utf-8");

    if (source.endsWith(".jsonl") || source.endsWith(".ndjson")) {
      const lines = raw.split("\n").filter((l) => l.trim());
      const docs: Document[] = [];
      for (let i = 0; i < lines.length; i++) {
        try {
          docs.push({
            content: JSON.stringify(JSON.parse(lines[i]), null, 2),
            metadata: { type: "json", lineIndex: i },
            source,
          });
        } catch {
          console.warn(`[loaders/json] Skipping malformed JSONL line ${i + 1} in ${source}`);
        }
      }
      return docs;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Failed to parse JSON from ${source}: ${(e as Error).message}`);
    }
    return [{ content: JSON.stringify(parsed, null, 2), metadata: { type: "json" }, source }];
  }
}
