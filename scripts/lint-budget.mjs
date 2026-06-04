#!/usr/bin/env node
// ============================================================
// lint-budget.mjs — bound the known lint-warning debt
// ============================================================
// Lint currently reports a fixed set of warnings (overwhelmingly
// @typescript-eslint/no-explicit-any in test files). They do not block lint,
// which means new warnings can slip in unnoticed. This script runs eslint,
// tallies warnings per rule, and fails if any rule exceeds its documented
// ceiling or if there are ANY errors — so the debt can only shrink, never grow.
//
// To intentionally raise a ceiling, edit BUDGET below in the same change that
// adds the warnings, so the budget stays an explicit, reviewed decision.
//
// Exit codes: 0 = within budget, 1 = over budget / errors, 2 = runner error.
// ============================================================

import { execFileSync } from "node:child_process";

// Per-rule maximum warning counts. Generated from the current tree; lower is
// better. A rule not listed here defaults to a ceiling of 0 (no new rules).
const BUDGET = {
  "@typescript-eslint/no-explicit-any": 416,
  "@typescript-eslint/no-unused-vars": 15,
  "prefer-const": 2,
};

function runEslint() {
  // eslint exits non-zero when there are errors; capture stdout either way.
  try {
    return execFileSync(
      "pnpm",
      ["exec", "eslint", "src/**/*.ts", "packages/*/src/**/*.ts", "-f", "json"],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: process.platform === "win32" },
    );
  } catch (err) {
    if (typeof err.stdout === "string" && err.stdout.trim().startsWith("[")) {
      return err.stdout;
    }
    throw err;
  }
}

function main() {
  let raw;
  try {
    raw = runEslint();
  } catch (err) {
    console.error(`[lint-budget] failed to run eslint: ${err.message}`);
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    console.error("[lint-budget] could not parse eslint JSON output.");
    process.exit(2);
  }

  const warnings = {};
  let errorCount = 0;
  for (const file of report) {
    for (const msg of file.messages ?? []) {
      if (msg.severity === 2) {
        errorCount++;
        console.error(`[lint-budget] error ${file.filePath}:${msg.line} ${msg.ruleId ?? ""} ${msg.message}`);
      } else if (msg.severity === 1) {
        const rule = msg.ruleId ?? "(unknown)";
        warnings[rule] = (warnings[rule] ?? 0) + 1;
      }
    }
  }

  let overBudget = false;
  const rules = new Set([...Object.keys(warnings), ...Object.keys(BUDGET)]);
  for (const rule of [...rules].sort()) {
    const count = warnings[rule] ?? 0;
    const max = BUDGET[rule] ?? 0;
    const flag = count > max ? "  OVER" : "";
    if (count > 0 || max > 0) {
      console.log(`[lint-budget] ${rule}: ${count} / ${max}${flag}`);
    }
    if (count > max) overBudget = true;
  }

  if (errorCount > 0) {
    console.error(`[lint-budget] ${errorCount} lint error(s) — errors are never budgeted.`);
    process.exit(1);
  }
  if (overBudget) {
    console.error("[lint-budget] warning budget exceeded. Fix the warnings or raise the ceiling in scripts/lint-budget.mjs (with review).");
    process.exit(1);
  }

  const total = Object.values(warnings).reduce((a, b) => a + b, 0);
  console.log(`[lint-budget] within budget: ${total} warning(s) across ${report.length} files, 0 errors.`);
}

main();
