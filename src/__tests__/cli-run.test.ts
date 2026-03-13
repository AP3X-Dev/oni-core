import { describe, it, expect } from "vitest";
import { resolveEntryFile, formatDuration } from "../cli/run.js";

describe("oni run", () => {
  describe("resolveEntryFile", () => {
    it("returns the file path if it ends with .ts or .js", () => {
      expect(resolveEntryFile("src/agent.ts")).toBe("src/agent.ts");
      expect(resolveEntryFile("dist/agent.js")).toBe("dist/agent.js");
    });

    it("appends .ts if no extension", () => {
      expect(resolveEntryFile("src/agent")).toBe("src/agent.ts");
    });

    it("preserves .mts and .mjs extensions", () => {
      expect(resolveEntryFile("src/agent.mts")).toBe("src/agent.mts");
      expect(resolveEntryFile("dist/agent.mjs")).toBe("dist/agent.mjs");
    });
  });

  describe("formatDuration", () => {
    it("formats milliseconds to readable string", () => {
      expect(formatDuration(500)).toBe("500ms");
      expect(formatDuration(1500)).toBe("1.50s");
      expect(formatDuration(65000)).toBe("1m 5s");
    });

    it("formats zero milliseconds", () => {
      expect(formatDuration(0)).toBe("0ms");
    });
  });
});
