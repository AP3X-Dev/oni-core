import { ONIHarness } from "../../src/harness/index.js";
import { openrouter } from "../../src/models/openrouter.js";
import { defineTool } from "../../src/tools/define.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, relative, resolve } from "node:path";
import type { BasePayload, PreToolUsePayload, StopPayload } from "../../src/harness/hooks-engine.js";
import type { Finding, AuditConfig, Category, Severity } from "./types.js";
import { findingId } from "./types.js";

// ── Ignore patterns ─────────────────────────────────────
const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "coverage", ".cache", ".turbo", ".vscode", ".idea", "__pycache__",
]);

const IGNORE_EXTENSIONS = new Set([
  ".lock", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff",
  ".woff2", ".ttf", ".eot", ".map", ".min.js", ".min.css",
]);

export interface AuditAgentResult {
  findings: Finding[];
  filesScanned: string[];
  toolCalls: number;
  duration: number;
}

export async function runAuditAgent(
  config: AuditConfig,
  diffFiles: string[],
  onProgress?: (msg: string) => void,
): Promise<AuditAgentResult> {
  const model = openrouter(config.model, { reasoningEffort: "low" });
  const fastModel = openrouter(config.model);
  const findings: Finding[] = [];
  const filesScanned = new Set<string>();
  const auditLog: Array<{ tool: string }> = [];
  const startTime = Date.now();

  // ── Tools (same as v1, but findings go to typed array) ──
  const treeTool = defineTool({
    name: "project_tree",
    description: "Recursively scan a directory and return the file tree. Skips node_modules, .git, dist, build, and binary files.",
    schema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Root directory to scan" },
        maxDepth: { type: "number", description: "Max depth (default: 6)" },
      },
      required: ["directory"],
    },
    execute: async (input: { directory: string; maxDepth?: number }) => {
      const root = resolve(input.directory);
      const maxDepth = input.maxDepth ?? 6;
      const tree: Array<{ path: string; size: number; lines: number; ext: string }> = [];
      let dirCount = 0;

      async function walk(dir: string, depth: number) {
        if (depth > maxDepth) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        dirCount++;

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
            await walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = extname(entry.name);
            if (IGNORE_EXTENSIONS.has(ext)) continue;
            try {
              const info = await stat(fullPath);
              if (info.size > 512_000) continue;
              const content = await readFile(fullPath, "utf-8");
              tree.push({ path: relative(root, fullPath).replace(/\\/g, "/"), size: info.size, lines: content.split("\n").length, ext });
            } catch { /* skip */ }
          }
        }
      }

      await walk(root, 0);
      tree.sort((a, b) => a.path.localeCompare(b.path));
      return { root: input.directory, totalFiles: tree.length, totalDirectories: dirCount, files: tree };
    },
  });

  const readFileTool = defineTool({
    name: "read_file",
    description: "Read a source file. Returns content with line numbers.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
        maxLines: { type: "number", description: "Max lines (default: 300)" },
      },
      required: ["path"],
    },
    execute: async (input: { path: string; maxLines?: number }) => {
      const content = await readFile(input.path, "utf-8");
      const lines = content.split("\n");
      const maxLines = input.maxLines ?? 300;
      filesScanned.add(input.path);
      return { path: input.path, content: lines.slice(0, maxLines).join("\n"), totalLines: lines.length, truncated: lines.length > maxLines };
    },
  });

  const searchTool = defineTool({
    name: "search_code",
    description: "Search for a pattern across all files in a directory. Returns matching lines.",
    schema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Root directory" },
        pattern: { type: "string", description: "Regex pattern" },
        extensions: { type: "array", items: { type: "string" }, description: "File extensions filter" },
        maxResults: { type: "number", description: "Max results (default: 30)" },
      },
      required: ["directory", "pattern"],
    },
    execute: async (input: { directory: string; pattern: string; extensions?: string[]; maxResults?: number }) => {
      const root = resolve(input.directory);
      const maxResults = input.maxResults ?? 30;
      const extFilter = input.extensions?.length ? new Set(input.extensions) : null;
      const regex = new RegExp(input.pattern, "gi");
      const matches: Array<{ file: string; line: number; text: string }> = [];

      async function walk(dir: string) {
        if (matches.length >= maxResults) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (matches.length >= maxResults) return;
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
            await walk(fullPath);
          } else if (entry.isFile()) {
            const ext = extname(entry.name);
            if (IGNORE_EXTENSIONS.has(ext)) continue;
            if (extFilter && !extFilter.has(ext)) continue;
            try {
              const content = await readFile(fullPath, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                if (regex.test(lines[i]!)) {
                  matches.push({ file: relative(root, fullPath).replace(/\\/g, "/"), line: i + 1, text: lines[i]!.trim().slice(0, 200) });
                }
                regex.lastIndex = 0;
              }
            } catch { /* skip */ }
          }
        }
      }

      await walk(root);
      return { pattern: input.pattern, matchCount: matches.length, matches };
    },
  });

  const reportTool = defineTool({
    name: "write_report",
    description: "Record an audit finding. Call for EVERY issue discovered.",
    schema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["critical", "warning", "info"] },
        category: { type: "string", enum: ["security", "error-handling", "types", "performance", "code-smell", "architecture", "testing", "documentation"] },
        file: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number" },
        issue: { type: "string", description: "Issue description" },
        suggestion: { type: "string", description: "How to fix" },
      },
      required: ["severity", "category", "file", "issue"],
    },
    execute: async (input: { severity: string; category: string; file: string; line?: number; issue: string; suggestion?: string }) => {
      findings.push({
        id: findingId(),
        severity: input.severity as Severity,
        category: input.category as Category,
        file: input.file,
        line: input.line,
        issue: input.issue,
        suggestion: input.suggestion,
        source: "llm",
      });
      onProgress?.(`  [${input.severity}] ${input.category} — ${input.file}${input.line ? `:${input.line}` : ""}`);
      return { recorded: true, findingNumber: findings.length };
    },
  });

  // ── Build prompt ────────────────────────────────────────
  const diffContext = config.mode === "diff" && diffFiles.length > 0
    ? `\n\nFOCUS ON THESE CHANGED FILES (diff mode):\n${diffFiles.map((f) => `  - ${f}`).join("\n")}\n\nRead and audit these files first. You may also read other files for context.`
    : "";

  const soul = `You are a senior code auditor. You perform autonomous deep audits.

RULES:
- There is NO tool call limit. Call as many tools as needed.
- NEVER respond with text only. ALWAYS include tool calls.
- Call write_report IMMEDIATELY when you find an issue.
- Focus on SEMANTIC issues: architecture, error handling, security logic, missing validation.
- Do NOT flag mechanical issues like "any" types or console.log — those are handled separately.

WORKFLOW:
1. project_tree to map the codebase
2. read_file on key source files
3. search_code for anti-patterns
4. write_report for every issue found

Categories: security, error-handling, types, performance, code-smell, architecture, testing, documentation.`;

  // ── Quality gate ────────────────────────────────────────
  let pushbacks = 0;
  const MAX_PUSHBACKS = 3;

  const harness = ONIHarness.create({
    model,
    fastModel,
    soul,
    sharedTools: [treeTool, readFileTool, searchTool, reportTool],
    maxTurns: 30,
    maxTokens: 16384,
    hooks: {
      PreToolUse: [{
        handler: async (payload: BasePayload) => {
          const p = payload as PreToolUsePayload;
          auditLog.push({ tool: p.toolName });
          return { decision: "allow" };
        },
      }],
      Stop: [{
        handler: async () => {
          if (pushbacks >= MAX_PUSHBACKS) return { decision: "allow" as const };

          const touchedFiles = new Set(filesScanned);
          for (const f of findings) touchedFiles.add(f.file);
          const searches = auditLog.filter((l) => l.tool === "search_code").length;
          const hasTree = auditLog.some((l) => l.tool === "project_tree");

          const issues: string[] = [];
          if (!hasTree) issues.push("Run project_tree first.");
          if (touchedFiles.size < 5) issues.push(`Only ${touchedFiles.size} files — read more.`);
          if (searches < 3) issues.push(`Only ${searches} searches — search more.`);
          if (findings.length < 3) issues.push(`Only ${findings.length} findings — dig deeper.`);

          if (issues.length > 0) {
            pushbacks++;
            return { decision: "block" as const, reason: `Audit incomplete. ${issues.join(" ")}` };
          }
          return { decision: "allow" as const };
        },
      }],
    },
    safety: { protectedTools: [] },
  });

  const prompt = `Audit the codebase at: ${config.targetDir}${diffContext}`;

  for await (const msg of harness.run(prompt, { name: "auditor" })) {
    if (msg.type === "assistant" && msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        onProgress?.(`  → ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)})`);
      }
    }
    if (msg.type === "error") {
      onProgress?.(`  [ERROR] ${msg.content}`);
    }
  }

  return {
    findings,
    filesScanned: [...filesScanned],
    toolCalls: auditLog.length,
    duration: Date.now() - startTime,
  };
}
