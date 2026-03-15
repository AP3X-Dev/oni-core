import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MarkdownLoader, JsonLoader, CsvLoader, getLoader } from "../index.js";

const __fixtures__ = join(fileURLToPath(import.meta.url), "../../__fixtures__");

describe("MarkdownLoader", () => {
  it("supports .md extension", () => {
    expect(new MarkdownLoader().supports(".md")).toBe(true);
    expect(new MarkdownLoader().supports(".txt")).toBe(false);
  });

  it("loads markdown file", async () => {
    const loader = new MarkdownLoader();
    const docs = await loader.load(join(__fixtures__, "test.md"));
    expect(docs).toHaveLength(1);
    expect(docs[0]!.content).toContain("# Test Document");
    expect(docs[0]!.metadata.type).toBe("markdown");
  });
});

describe("JsonLoader", () => {
  it("loads JSON file as formatted string", async () => {
    const loader = new JsonLoader();
    const docs = await loader.load(join(__fixtures__, "test.json"));
    expect(docs[0]!.content).toContain("test");
  });
});

describe("CsvLoader", () => {
  it("loads CSV as readable text", async () => {
    const loader = new CsvLoader();
    const docs = await loader.load(join(__fixtures__, "test.csv"));
    expect(docs[0]!.content).toContain("Alice");
    expect(docs[0]!.content).toContain("NYC");
  });
});

describe("getLoader", () => {
  it("returns correct loader for extension", () => {
    expect(getLoader("file.md")).toBeInstanceOf(MarkdownLoader);
    expect(getLoader("file.json")).toBeInstanceOf(JsonLoader);
    expect(getLoader("file.csv")).toBeInstanceOf(CsvLoader);
    expect(getLoader("file.xyz")).toBeNull();
  });
});
