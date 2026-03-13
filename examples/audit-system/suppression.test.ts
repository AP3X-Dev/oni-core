import { describe, it, expect } from "vitest";
import { loadSuppressions, isSuppressed } from "./suppression.js";
import type { Finding } from "./types.js";

const makeFinding = (file: string, category: string, line?: number): Finding => ({
  id: "test",
  severity: "warning",
  category: category as Finding["category"],
  file,
  line,
  issue: "test issue",
  source: "ast",
});

describe("suppression", () => {
  it("parses file:category rules", () => {
    const rules = loadSuppressions("src/context.ts:error-handling\n");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({ filePattern: "src/context.ts", category: "error-handling" });
  });

  it("parses file:line:category rules", () => {
    const rules = loadSuppressions("src/context.ts:48:error-handling\n");
    expect(rules[0]).toEqual({ filePattern: "src/context.ts", category: "error-handling", line: 48 });
  });

  it("ignores comments and blank lines", () => {
    const rules = loadSuppressions("# comment\n\n  \nsrc/a.ts:types\n");
    expect(rules).toHaveLength(1);
  });

  it("matches glob patterns", () => {
    const rules = loadSuppressions("**/*.test.ts:security\n");
    const finding = makeFinding("src/__tests__/foo.test.ts", "security");
    expect(isSuppressed(finding, rules)).toBe(true);
  });

  it("does not suppress non-matching category", () => {
    const rules = loadSuppressions("src/a.ts:security\n");
    const finding = makeFinding("src/a.ts", "types");
    expect(isSuppressed(finding, rules)).toBe(false);
  });

  it("wildcard category suppresses all", () => {
    const rules = loadSuppressions("dist/**:*\n");
    const finding = makeFinding("dist/index.js", "security");
    expect(isSuppressed(finding, rules)).toBe(true);
  });

  it("line-specific suppression only matches that line", () => {
    const rules = loadSuppressions("src/a.ts:10:types\n");
    expect(isSuppressed(makeFinding("src/a.ts", "types", 10), rules)).toBe(true);
    expect(isSuppressed(makeFinding("src/a.ts", "types", 11), rules)).toBe(false);
  });
});
