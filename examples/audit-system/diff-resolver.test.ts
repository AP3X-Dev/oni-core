import { describe, it, expect } from "vitest";
import { parseDiffOutput, resolveFiles } from "./diff-resolver.js";

describe("diff-resolver", () => {
  it("parses git diff --name-only output", () => {
    const output = "src/foo.ts\nsrc/bar.ts\nREADME.md\n";
    const files = parseDiffOutput(output);
    expect(files).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("filters to source files only", () => {
    const output = "src/foo.ts\npackage-lock.json\nsrc/bar.js\nimage.png\n";
    const files = parseDiffOutput(output, [".ts", ".js"]);
    expect(files).toEqual(["src/foo.ts", "src/bar.js"]);
  });

  it("handles empty diff", () => {
    expect(parseDiffOutput("")).toEqual([]);
    expect(parseDiffOutput("\n")).toEqual([]);
  });

  it("resolveFiles returns full mode when mode is full", async () => {
    const result = await resolveFiles({ mode: "full", targetDir: ".", baseBranch: "main" });
    expect(result.mode).toBe("full");
    // In full mode, files is empty — the audit agent scans everything
    expect(result.files).toEqual([]);
  });
});
