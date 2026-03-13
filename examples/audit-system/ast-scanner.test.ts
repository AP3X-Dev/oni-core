import { describe, it, expect } from "vitest";
import { scanSource } from "./ast-scanner.js";

describe("ast-scanner", () => {
  it("detects eval() calls", () => {
    const findings = scanSource("test.ts", `const x = eval("1+1");`);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("security");
    expect(findings[0]!.issue).toContain("eval()");
  });

  it("ignores eval in string literals and comments", () => {
    const code = `
      // pattern for eval detection
      const PATTERNS = [/eval\\(/];
      const msg = "do not use eval()";
    `;
    const findings = scanSource("test.ts", code);
    expect(findings).toHaveLength(0);
  });

  it("detects explicit any type annotations", () => {
    const findings = scanSource("test.ts", `function foo(x: any): any { return x; }`);
    const anyFindings = findings.filter((f) => f.issue.includes("any"));
    expect(anyFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores any in .test.ts files", () => {
    const findings = scanSource("foo.test.ts", `function foo(x: any) { return x; }`);
    const anyFindings = findings.filter((f) => f.issue.includes("any"));
    expect(anyFindings).toHaveLength(0);
  });

  it("detects empty catch blocks", () => {
    const findings = scanSource("test.ts", `try { foo(); } catch (e) { }`);
    expect(findings.some((f) => f.issue.includes("catch"))).toBe(true);
  });

  it("allows catch with comment", () => {
    const findings = scanSource("test.ts", `try { foo(); } catch { /* expected */ }`);
    const catchFindings = findings.filter((f) => f.issue.includes("catch"));
    expect(catchFindings).toHaveLength(0);
  });

  it("detects console.log in non-test source files", () => {
    const findings = scanSource("src/app.ts", `console.log("debug");`);
    expect(findings.some((f) => f.issue.includes("console"))).toBe(true);
  });

  it("ignores console.log in test files", () => {
    const findings = scanSource("src/app.test.ts", `console.log("debug");`);
    const consoleFinding = findings.filter((f) => f.issue.includes("console"));
    expect(consoleFinding).toHaveLength(0);
  });
});
