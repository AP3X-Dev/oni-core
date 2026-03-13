import type { AuditReport, Finding } from "./types.js";

// ── Console ──────────────────────────────────────────────

export function formatConsole(report: AuditReport): string {
  const lines: string[] = [];
  const sep = "═".repeat(60);
  const thin = "─".repeat(60);

  lines.push(sep);
  lines.push("AUDIT REPORT");
  lines.push(sep);
  lines.push(`\nTarget: ${report.target}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Duration: ${(report.duration / 1000).toFixed(1)}s`);
  lines.push(`Files analyzed: ${report.filesAnalyzed.length}`);
  for (const f of report.filesAnalyzed.sort()) lines.push(`  • ${f}`);

  const critical = report.findings.filter((f) => f.severity === "critical");
  const warnings = report.findings.filter((f) => f.severity === "warning");
  const info = report.findings.filter((f) => f.severity === "info");

  lines.push(`\nFindings: ${report.findings.length}`);
  lines.push(`  Critical: ${critical.length}  |  Warning: ${warnings.length}  |  Info: ${info.length}`);
  if (report.suppressed > 0) lines.push(`  Suppressed: ${report.suppressed}`);
  if (report.rejected > 0) lines.push(`  Rejected (false positive): ${report.rejected}`);

  const categories: Record<string, number> = {};
  for (const f of report.findings) categories[f.category] = (categories[f.category] ?? 0) + 1;
  if (Object.keys(categories).length > 0) {
    lines.push(`\nBy category:`);
    for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${cat}: ${count}`);
    }
  }

  for (const [label, group, icon] of [
    ["CRITICAL ISSUES", critical, "🔴"],
    ["WARNINGS", warnings, "🟡"],
    ["INFO", info, "🔵"],
  ] as const) {
    if (group.length === 0) continue;
    lines.push(`\n${thin}`);
    lines.push(`${icon} ${label} (${group.length})`);
    lines.push(thin);
    for (let i = 0; i < group.length; i++) {
      const f = group[i]!;
      lines.push(`\n  #${i + 1} [${f.category}] ${f.file}${f.line ? `:${f.line}` : ""} (${f.source}${f.confidence ? `, ${(f.confidence * 100).toFixed(0)}%` : ""})`);
      lines.push(`     ${f.issue}`);
      if (f.suggestion) lines.push(`     → ${f.suggestion}`);
    }
  }

  lines.push(`\n${sep}`);
  return lines.join("\n");
}

// ── JSON ─────────────────────────────────────────────────

export function formatJSON(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

// ── SARIF ────────────────────────────────────────────────

function severityToSarif(severity: string): string {
  switch (severity) {
    case "critical": return "error";
    case "warning": return "warning";
    case "info": return "note";
    default: return "none";
  }
}

export function formatSARIF(report: AuditReport): string {
  const sarif = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0" as const,
    runs: [{
      tool: {
        driver: {
          name: "oni-audit",
          version: "2.0.0",
          informationUri: "https://github.com/oni-bot/core",
          rules: [...new Set(report.findings.map((f) => f.category))].map((cat) => ({
            id: cat,
            shortDescription: { text: cat },
          })),
        },
      },
      results: report.findings.map((f) => ({
        ruleId: f.category,
        level: severityToSarif(f.severity),
        message: {
          text: f.issue + (f.suggestion ? ` Fix: ${f.suggestion}` : ""),
        },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: f.file },
            region: f.line ? { startLine: f.line } : undefined,
          },
        }],
        properties: {
          source: f.source,
          confidence: f.confidence,
          verified: f.verified,
        },
      })),
    }],
  };
  return JSON.stringify(sarif, null, 2);
}
