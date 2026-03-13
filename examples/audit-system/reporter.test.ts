import { describe, it, expect } from "vitest";
import { formatConsole, formatJSON, formatSARIF } from "./reporter.js";
import type { AuditReport } from "./types.js";

const report: AuditReport = {
  target: "/project",
  mode: "diff",
  duration: 12345,
  filesAnalyzed: ["src/a.ts", "src/b.ts"],
  findings: [
    { id: "f1", severity: "critical", category: "security", file: "src/a.ts", line: 10, issue: "eval usage", source: "ast", verified: true, confidence: 0.9 },
    { id: "f2", severity: "warning", category: "types", file: "src/b.ts", line: 20, issue: "any type", suggestion: "Use unknown", source: "ast", verified: true, confidence: 0.8 },
  ],
  suppressed: 1,
  rejected: 2,
  timestamp: "2026-03-09T00:00:00.000Z",
};

describe("reporter", () => {
  it("formats console output with severity counts", () => {
    const output = formatConsole(report);
    expect(output).toContain("Critical: 1");
    expect(output).toContain("Warning: 1");
    expect(output).toContain("eval usage");
  });

  it("formats JSON with all fields", () => {
    const json = formatJSON(report);
    const parsed = JSON.parse(json);
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.suppressed).toBe(1);
    expect(parsed.rejected).toBe(2);
  });

  it("formats SARIF with correct schema", () => {
    const sarif = formatSARIF(report);
    const parsed = JSON.parse(sarif);
    expect(parsed.$schema).toContain("sarif");
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].results).toHaveLength(2);
  });

  it("SARIF maps severity to SARIF levels", () => {
    const sarif = JSON.parse(formatSARIF(report));
    const results = sarif.runs[0].results;
    expect(results[0].level).toBe("error"); // critical → error
    expect(results[1].level).toBe("warning"); // warning → warning
  });
});
