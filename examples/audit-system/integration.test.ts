import { describe, it, expect } from "vitest";
import { scanSource } from "./ast-scanner.js";
import { loadSuppressions, isSuppressed } from "./suppression.js";
import { parseDiffOutput } from "./diff-resolver.js";
import { buildVerifyPrompt, parseVerifyResponse } from "./verify-agent.js";
import { formatConsole, formatJSON, formatSARIF } from "./reporter.js";
import type { AuditReport, Finding } from "./types.js";

describe("audit system v2 integration", () => {
  it("full pipeline: AST scan → suppress → report", () => {
    // 1. AST scan finds issues
    const findings = scanSource("src/bad.ts", `
      const x: any = eval("1+1");
      try { foo(); } catch (e) { }
      console.log("debug");
    `);
    expect(findings.length).toBeGreaterThanOrEqual(3);

    // 2. Suppress the console.log finding
    const rules = loadSuppressions("src/bad.ts:code-smell\n");
    const unsuppressed = findings.filter((f) => !isSuppressed(f, rules));
    expect(unsuppressed.length).toBeLessThan(findings.length);

    // 3. Report
    const report: AuditReport = {
      target: ".",
      mode: "full",
      duration: 1000,
      filesAnalyzed: ["src/bad.ts"],
      findings: unsuppressed,
      suppressed: findings.length - unsuppressed.length,
      rejected: 0,
      timestamp: new Date().toISOString(),
    };

    const console_out = formatConsole(report);
    expect(console_out).toContain("eval()");
    expect(console_out).toContain("AUDIT REPORT");

    const json = JSON.parse(formatJSON(report));
    expect(json.findings.length).toBe(unsuppressed.length);

    const sarif = JSON.parse(formatSARIF(report));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBe(unsuppressed.length);
  });

  it("diff resolver filters source files", () => {
    const files = parseDiffOutput("a.ts\nb.js\nc.png\nd.lock\ne.tsx\n");
    expect(files).toEqual(["a.ts", "b.js", "e.tsx"]);
  });

  it("deduplicates findings by file:line:category", () => {
    const findings: Finding[] = [
      { id: "1", severity: "warning", category: "types", file: "src/a.ts", line: 10, issue: "any from AST", source: "ast" },
      { id: "2", severity: "warning", category: "types", file: "src/a.ts", line: 10, issue: "any from LLM", source: "llm" },
      { id: "3", severity: "critical", category: "security", file: "src/a.ts", line: 10, issue: "different category", source: "ast" },
    ];
    const seen = new Set<string>();
    const deduped: Finding[] = [];
    for (const f of findings) {
      const key = `${f.file}:${f.line ?? 0}:${f.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(f);
    }
    expect(deduped).toHaveLength(2); // first any + security (second any is duplicate)
    expect(deduped[0]!.source).toBe("ast"); // AST finding kept (comes first)
  });

  it("verify agent handles edge cases", () => {
    expect(parseVerifyResponse("garbage").confirmed).toBe(true);
    expect(parseVerifyResponse('{"confirmed":false,"confidence":0.1,"reason":"fp"}').confirmed).toBe(false);
  });
});
