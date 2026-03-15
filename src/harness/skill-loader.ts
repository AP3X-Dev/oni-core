// ============================================================
// @oni.bot/core/harness — SkillLoader
// SKILL.md discovery and on-demand injection into agent loop
// ============================================================

import type { ToolDefinition } from "../tools/types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillDefinition {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  content: string;
  sourcePath: string;
  /** Comma-separated tool patterns pre-approved during skill execution. */
  allowedTools?: string[];
  /** Hint for arguments (e.g. "[file-path]"). */
  argumentHint?: string;
  /** If true, agent cannot auto-invoke — user only via /name. */
  disableModelInvocation?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape a string for safe interpolation inside XML attributes / text. */
function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Frontmatter Parser ──────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { meta: {}, body: raw };
  }

  const end = trimmed.indexOf("---", 3);
  if (end === -1) {
    return { meta: {}, body: raw };
  }

  const frontBlock = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 3).trim();

  const meta: Record<string, string | string[]> = {};
  for (const line of frontBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    // Handle comma-separated values for array fields
    if (key === "tools" || key === "allowed-tools") {
      meta[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      meta[key] = value;
    }
  }

  return { meta, body };
}

// ─── SkillLoader ─────────────────────────────────────────────────────────────

export class SkillLoader {
  private skills: Map<string, SkillDefinition> = new Map();
  private pendingInjection: string | null = null;
  /** Monotonically increasing version — bumps on any skill registration or load. */
  version = 0;

  // ── Static Constructors (Node.js only) ───────────────────────────────

  /**
   * Scan a single directory (recursively) for SKILL.md files.
   * Uses dynamic require("fs") — safe to call in non-Node envs (returns empty loader).
   */
  static fromDirectory(dir: string): SkillLoader {
    const loader = new SkillLoader();
    loader.loadDirectory(dir);
    return loader;
  }

  /**
   * Scan multiple directories for SKILL.md files.
   */
  static fromDirectories(dirs: string[]): SkillLoader {
    const loader = new SkillLoader();
    for (const dir of dirs) {
      loader.loadDirectory(dir);
    }
    return loader;
  }

  // ── Private: Filesystem Loading ──────────────────────────────────────

  private loadDirectory(dir: string): void {
    try {
      // Dynamic require to avoid bundler issues in non-Node envs
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("path") as typeof import("path");
      this.scanDirectory(dir, fs, path);
    } catch {
      // Not in Node.js or fs unavailable — silently skip
    }
  }

  private scanDirectory(
    dir: string,
    fs: typeof import("fs"),
    path: typeof import("path"),
  ): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          this.scanDirectory(full, fs, path);
        } else if (entry === "SKILL.md") {
          this.loadSkillFile(full, fs);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  private loadSkillFile(filePath: string, fs: typeof import("fs")): boolean {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);

      const name = (meta.name as string) || "";
      if (!name) return false;

      const skill: SkillDefinition = {
        name,
        description: (meta.description as string) || "",
        content: body,
        sourcePath: filePath,
      };

      if (meta.tools) {
        skill.tools = Array.isArray(meta.tools) ? meta.tools : [meta.tools];
      }
      if (meta.model) {
        skill.model = meta.model as string;
      }
      if (meta["allowed-tools"]) {
        const val = meta["allowed-tools"];
        skill.allowedTools = Array.isArray(val) ? val : [val];
      }
      if (meta["argument-hint"]) {
        skill.argumentHint = meta["argument-hint"] as string;
      }
      if (meta["disable-model-invocation"] === "true") {
        skill.disableModelInvocation = true;
      }

      this.skills.set(name, skill);
      this.version++;
      return true;
    } catch {
      // Skip unreadable files
      return false;
    }
  }

  /**
   * Create a fork that shares the skill catalog but has its own isolated
   * pendingInjection state. Use when multiple concurrent agents share the
   * same SkillLoader to prevent one agent's skill invocation from being
   * consumed by another agent.
   */
  fork(): SkillLoader {
    const forked = new SkillLoader();
    forked.skills = new Map(this.skills); // shallow copy — isolates mutations between fork and original
    forked.version = this.version;
    return forked;
  }

  // ── Programmatic Registration ────────────────────────────────────────

  /**
   * Register a skill definition programmatically (works in all runtimes).
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
    this.version++;
  }

  /**
   * Load a single skill from a file path.
   * Works in Node.js runtimes. Returns true on success.
   */
  loadSkillFromFile(filePath: string): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      // Note: loadSkillFile already increments this.version on success.
      return this.loadSkillFile(filePath, fs);
    } catch {
      return false;
    }
  }

  // ── Retrieval ────────────────────────────────────────────────────────

  /**
   * Get all registered skills.
   */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a single skill by name.
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  // ── Context Generation ───────────────────────────────────────────────

  /**
   * Returns `<available-skills>` XML string with lean descriptions.
   * Returns "" if no skills are registered.
   */
  getDescriptionsForContext(): string {
    if (this.skills.size === 0) return "";

    const lines: string[] = ["<available-skills>"];
    for (const skill of this.skills.values()) {
      lines.push(`  <skill name="${escXml(skill.name)}">${escXml(skill.description)}</skill>`);
    }
    lines.push("</available-skills>");
    return lines.join("\n");
  }

  // ── Invocation & Injection ───────────────────────────────────────────

  /**
   * Queue a skill's content for injection into the next turn.
   * Returns true if skill found, false otherwise.
   */
  invoke(name: string, args?: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    const argsBlock = args ? `\n\n## Input\n\n${args}` : "";
    this.pendingInjection = `<skill-instructions name="${escXml(name)}">\n${skill.content}${argsBlock}\n</skill-instructions>`;
    return true;
  }

  /**
   * Get the pending injection content (if any).
   */
  getPendingInjection(): string | null {
    return this.pendingInjection;
  }

  /**
   * Clear the pending injection queue.
   */
  clearPendingInjection(): void {
    this.pendingInjection = null;
  }

  // ── Skill Tool ───────────────────────────────────────────────────────

  /**
   * Returns an ONI-Core ToolDefinition for the "Skill" tool.
   * This tool allows the agent to invoke skills by name.
   */
  getSkillTool(): ToolDefinition<{ name: string }, string> {
    return {
      name: "Skill",
      description:
        "Invoke a skill by name. Skills provide specialized capabilities and domain knowledge. " +
        "Use this tool when a user's request matches an available skill.",
      schema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The skill name to invoke",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      execute: (input: { name: string }): string => {
        const found = this.invoke(input.name);
        if (found) {
          return JSON.stringify({ success: true, skill: input.name });
        }
        return JSON.stringify({
          error: `Skill "${input.name}" not found. Check available skills and try again.`,
        });
      },
    };
  }
}
