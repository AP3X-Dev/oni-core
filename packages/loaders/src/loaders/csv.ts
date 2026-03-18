import { readFile } from "node:fs/promises";
import { DocumentLoader, type Document } from "../types.js";

export class CsvLoader extends DocumentLoader {
  supports(ext: string): boolean {
    return [".csv", ".tsv"].includes(ext.toLowerCase());
  }

  async load(source: string): Promise<Document[]> {
    const raw = await readFile(source, "utf-8");
    const separator = source.endsWith(".tsv") ? "\t" : ",";
    const rows = parseCSV(raw, separator);
    if (rows.length === 0) return [];
    const [header, ...data] = rows;
    const content = data
      .map((row) => header!.map((h, i) => `${h}: ${row[i] ?? ""}`).join(", "))
      .join("\n");
    return [
      {
        content,
        metadata: { type: "csv", rows: data.length, columns: header?.length ?? 0 },
        source,
      },
    ];
  }
}

function parseCSV(text: string, sep: string): string[][] {
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    let wasQuoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
          if (inQuotes) wasQuoted = true;
        }
      } else if (ch === sep && !inQuotes) {
        fields.push(wasQuoted ? current : current.trim());
        current = "";
        wasQuoted = false;
      } else {
        current += ch;
      }
    }
    fields.push(wasQuoted ? current : current.trim());
    rows.push(fields);
  }
  return rows;
}
