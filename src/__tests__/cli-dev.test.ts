import { describe, it, expect } from "vitest";
import { resolveDevFile, formatRestart } from "../cli/dev.js";

describe("oni dev", () => {
  describe("resolveDevFile", () => {
    it("uses provided file", () => {
      expect(resolveDevFile("src/agent.ts")).toBe("src/agent.ts");
    });

    it("defaults to src/index.ts when no file provided", () => {
      expect(resolveDevFile(undefined)).toBe("src/index.ts");
    });
  });

  describe("formatRestart", () => {
    it("formats restart count", () => {
      expect(formatRestart(1)).toContain("#1");
      expect(formatRestart(5)).toContain("#5");
    });
  });
});
