// ============================================================
// ONI Audit System v2
// CI-first codebase audit with AST + LLM + verification
// ============================================================
// Usage:
//   npx tsx examples/audit-system/index.ts             # diff mode
//   npx tsx examples/audit-system/index.ts --full      # full scan
//   npx tsx examples/audit-system/index.ts --format json
//   npx tsx examples/audit-system/index.ts --format sarif
//   npx tsx examples/audit-system/index.ts --no-verify
//   npx tsx examples/audit-system/index.ts --dir ./other-repo

import { config } from "dotenv";
import { resolve, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: join(__dirname, ".env") });

import type { AuditConfig, AuditReport, Finding, ReportFormat } from "./types.js";
import { resolveFiles } from "./diff-resolver.js";
import { scanFiles } from "./ast-scanner.js";
import { runAuditAgent } from "./audit-agent.js";
import { verifyFindings } from "./verify-agent.js";
import { loadSuppressionsFromFile, isSuppressed } from "./suppression.js";
import { formatConsole, formatJSON, formatSARIF } from "./reporter.js";

// ── Parse CLI args ───────────────────────────────────────

function parseArgs(): AuditConfig {
  const args = process.argv.slice(2);

  let mode: "diff" | "full" = "diff";
  let format: ReportFormat = "console";
  let targetDir = ".";
  let baseBranch = "main";
  let verify = true;
  let ignoreFile = join(__dirname, ".oni-audit-ignore");
  const model = process.env["OPENROUTER_MODEL"] ?? "inception/mercury-2";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--full") mode = "full";
    else if (arg === "--format" && args[i + 1]) { format = args[++i]! as ReportFormat; }
    else if (arg === "--dir" && args[i + 1]) { targetDir = args[++i]!; }
    else if (arg === "--base" && args[i + 1]) { baseBranch = args[++i]!; }
    else if (arg === "--no-verify") verify = false;
    else if (arg === "--ignore" && args[i + 1]) { ignoreFile = args[++i]!; }
    else if (!arg.startsWith("--")) targetDir = arg;
  }

  return { targetDir: resolve(targetDir), mode, format, baseBranch, verify, ignoreFile, model };
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  const cfg = parseArgs();
  const startTime = Date.now();

  console.log("ONI Audit System v2");
  console.log("═".repeat(60));
  console.log(`Model: ${cfg.model}`);
  console.log(`Mode: ${cfg.mode}`);
  console.log(`Target: ${cfg.targetDir}`);
  console.log(`Verify: ${cfg.verify}`);
  console.log(`Format: ${cfg.format}\n`);

  // ── Phase 1: Resolve files ────────────────────────────
  console.log("[1/5] Resolving files...");
  const diff = await resolveFiles({ mode: cfg.mode, targetDir: cfg.targetDir, baseBranch: cfg.baseBranch });
  if (diff.mode === "diff") {
    console.log(`  ${diff.files.length} changed files (vs ${cfg.baseBranch})`);
  } else {
    console.log("  Full scan mode");
  }

  // ── Phase 2: AST scan ─────────────────────────────────
  console.log("\n[2/5] AST scanning...");
  const filesToScan = diff.mode === "diff" ? diff.files : [];
  let astFindings: Finding[] = [];
  if (filesToScan.length > 0) {
    astFindings = await scanFiles(filesToScan, cfg.targetDir);
    console.log(`  ${astFindings.length} findings from AST`);
  } else if (diff.mode === "full") {
    // In full mode, AST scan walks the tree itself
    const { readdir } = await import("node:fs/promises");
    const { extname } = await import("node:path");
    const allFiles: string[] = [];

    const IGNORE = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".cache"]);

    async function collectFiles(dir: string, rel: string) {
      let entries;
      try { entries = await readdir(join(cfg.targetDir, rel || "."), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
          await collectFiles(join(dir, e.name), relPath);
        } else if (e.isFile()) {
          const ext = extname(e.name);
          if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) allFiles.push(relPath);
        }
      }
    }

    await collectFiles(cfg.targetDir, "");
    astFindings = await scanFiles(allFiles, cfg.targetDir);
    console.log(`  ${astFindings.length} findings from AST (${allFiles.length} files scanned)`);
  }

  // ── Phase 3: LLM audit ────────────────────────────────
  console.log("\n[3/5] LLM audit...");
  const agentResult = await runAuditAgent(cfg, diff.files, (msg) => console.log(msg));
  console.log(`  ${agentResult.findings.length} findings from LLM (${agentResult.toolCalls} tool calls, ${(agentResult.duration / 1000).toFixed(1)}s)`);

  // ── Merge + deduplicate findings ─────────────────────
  const merged = [...astFindings, ...agentResult.findings];
  const seen = new Set<string>();
  const allFindings: Finding[] = [];
  for (const f of merged) {
    const key = `${f.file}:${f.line ?? 0}:${f.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allFindings.push(f);
  }
  if (merged.length !== allFindings.length) {
    console.log(`  Deduplicated: ${merged.length} → ${allFindings.length} (${merged.length - allFindings.length} duplicates removed)`);
  }

  // ── Phase 4: Verify ───────────────────────────────────
  let verifiedFindings: Finding[];
  let rejected = 0;

  if (cfg.verify && allFindings.length > 0) {
    console.log(`\n[4/5] Verifying ${allFindings.length} findings...`);
    verifiedFindings = await verifyFindings(allFindings, cfg.targetDir, cfg.model, (msg) => console.log(msg));
    rejected = allFindings.length - verifiedFindings.length;
    console.log(`  ${verifiedFindings.length} confirmed, ${rejected} rejected`);
  } else {
    console.log("\n[4/5] Verification skipped");
    verifiedFindings = allFindings.map((f) => ({ ...f, verified: false }));
  }

  // ── Phase 5: Suppress + Report ────────────────────────
  console.log("\n[5/5] Generating report...");
  const rules = loadSuppressionsFromFile(cfg.ignoreFile);
  const suppressed = verifiedFindings.filter((f) => isSuppressed(f, rules)).length;
  const finalFindings = verifiedFindings.filter((f) => !isSuppressed(f, rules));

  const analyzedFiles = new Set([...agentResult.filesScanned]);
  for (const f of finalFindings) analyzedFiles.add(f.file);

  const report: AuditReport = {
    target: cfg.targetDir,
    mode: cfg.mode,
    duration: Date.now() - startTime,
    filesAnalyzed: [...analyzedFiles].sort(),
    findings: finalFindings,
    suppressed,
    rejected,
    timestamp: new Date().toISOString(),
  };

  // ── Output ────────────────────────────────────────────
  switch (cfg.format) {
    case "json": {
      const json = formatJSON(report);
      await writeFile("oni-audit-report.json", json);
      console.log(`\nReport written to oni-audit-report.json`);
      break;
    }
    case "sarif": {
      const sarif = formatSARIF(report);
      await writeFile("oni-audit-report.sarif", sarif);
      console.log(`\nReport written to oni-audit-report.sarif`);
      break;
    }
    case "console":
    default:
      console.log(`\n${formatConsole(report)}`);
      break;
  }

  // Exit with error code if critical findings
  const criticalCount = finalFindings.filter((f) => f.severity === "critical").length;
  if (criticalCount > 0) {
    console.log(`\n❌ ${criticalCount} critical finding(s) — failing CI`);
    process.exit(1);
  }

  console.log(`\n✓ Audit complete (${(report.duration / 1000).toFixed(1)}s)`);
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(2);
});
