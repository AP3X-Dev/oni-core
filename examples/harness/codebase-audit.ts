// ============================================================
// @oni.bot/core — Codebase Audit Agent
// Single agent with safety gate + custom hooks scanning files
// Demonstrates: ONIHarness, HooksEngine, SafetyGate, custom tools
// ============================================================
// Run: ANTHROPIC_API_KEY=sk-... npx tsx examples/harness/codebase-audit.ts [dir]

import { ONIHarness } from "../../src/harness/index.js";
import { anthropic } from "../../src/models/anthropic.js";
import { defineTool } from "../../src/tools/define.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { BasePayload, PreToolUsePayload } from "../../src/harness/hooks-engine.js";

// ── Models ───────────────────────────────────────────────────
const model = anthropic("claude-sonnet-4-20250514");
const fastModel = anthropic("claude-haiku-4-5-20251001");

// ── Audit Tools ──────────────────────────────────────────────
const listFilesTool = defineTool({
  name: "list_files",
  description: "List files in a directory (non-recursive). Returns file names with sizes.",
  schema: {
    type: "object",
    properties: {
      directory: { type: "string", description: "Directory path to list" },
      extension: { type: "string", description: "Optional file extension filter (e.g. '.ts')" },
    },
    required: ["directory"],
  },
  execute: async (input: { directory: string; extension?: string }) => {
    const entries = await readdir(input.directory, { withFileTypes: true });
    const files: Array<{ name: string; size: number; type: string }> = [];

    for (const entry of entries) {
      if (entry.isFile()) {
        if (input.extension && !entry.name.endsWith(input.extension)) continue;
        const info = await stat(join(input.directory, entry.name));
        files.push({ name: entry.name, size: info.size, type: extname(entry.name) });
      }
    }
    return { directory: input.directory, files, count: files.length };
  },
});

const readFileTool = defineTool({
  name: "read_file",
  description: "Read the contents of a file. Returns the file content as text.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read" },
      maxLines: { type: "number", description: "Maximum lines to read (default: 200)" },
    },
    required: ["path"],
  },
  execute: async (input: { path: string; maxLines?: number }) => {
    const content = await readFile(input.path, "utf-8");
    const lines = content.split("\n");
    const maxLines = input.maxLines ?? 200;
    const truncated = lines.length > maxLines;
    return {
      path: input.path,
      content: lines.slice(0, maxLines).join("\n"),
      totalLines: lines.length,
      truncated,
    };
  },
});

const reportTool = defineTool({
  name: "write_report",
  description: "Write an audit finding to the report",
  schema: {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["critical", "warning", "info"], description: "Severity level" },
      file: { type: "string", description: "File path where issue was found" },
      line: { type: "number", description: "Line number (approximate)" },
      issue: { type: "string", description: "Description of the issue" },
      suggestion: { type: "string", description: "How to fix it" },
    },
    required: ["severity", "file", "issue"],
  },
  execute: async (input: { severity: string; file: string; line?: number; issue: string; suggestion?: string }) => {
    const icon = input.severity === "critical" ? "!!" : input.severity === "warning" ? "!" : "i";
    console.log(`  [${icon}] ${input.severity.toUpperCase()} — ${input.file}${input.line ? `:${input.line}` : ""}`);
    console.log(`      ${input.issue}`);
    if (input.suggestion) console.log(`      Fix: ${input.suggestion}`);
    return { recorded: true };
  },
});

// ── Custom Hooks ─────────────────────────────────────────────
const auditLog: Array<{ tool: string; path?: string; timestamp: number }> = [];

// ── Create Harness ───────────────────────────────────────────
const harness = ONIHarness.create({
  model,
  fastModel,
  soul: `You are a senior code auditor. Given a directory, systematically:
1. List files to understand the project structure
2. Read key files (entry points, configs, core modules)
3. Look for: security issues, error handling gaps, missing types, code smells
4. Report each finding with severity, location, and fix suggestion
Be thorough but prioritize critical issues.`,
  sharedTools: [listFilesTool, readFileTool, reportTool],
  maxTurns: 15,
  hooks: {
    PreToolUse: [{
      description: "Log all tool usage for audit trail",
      handler: async (payload: BasePayload) => {
        const p = payload as PreToolUsePayload;
        const path = p.input?.path ?? p.input?.directory ?? "";
        auditLog.push({ tool: p.toolName, path: path as string, timestamp: Date.now() });
        return { decision: "allow" };
      },
    }],
    SessionEnd: [{
      handler: async () => {
        console.log(`\n  Audit trail: ${auditLog.length} tool calls recorded`);
        return { decision: "allow" };
      },
    }],
  },
  safety: {
    protectedTools: [],  // read-only tools, no safety gate needed
  },
});

// ── Run ──────────────────────────────────────────────────────
async function main() {
  console.log("ONI Codebase Audit Agent");
  console.log("=".repeat(50));

  const targetDir = process.argv[2] ?? "./src/harness";
  console.log(`\nAuditing: ${targetDir}\n`);

  const result = await harness.runToResult(
    `Audit the code in directory: ${targetDir}. Focus on TypeScript files. Report all findings.`,
    { name: "auditor" },
  );

  console.log("\n" + "─".repeat(50));
  console.log("Audit Summary:");
  console.log(result.slice(0, 500));
}

main().catch(console.error);
