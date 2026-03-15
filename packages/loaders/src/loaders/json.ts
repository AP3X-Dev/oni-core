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
      return lines.map((line, i) => ({
        content: JSON.stringify(JSON.parse(line), null, 2),
        metadata: { type: "json", lineIndex: i },
        source,
      }));
    }

    const parsed = JSON.parse(raw) as unknown;
    return [{ content: JSON.stringify(parsed, null, 2), metadata: { type: "json" }, source }];
  }
}
