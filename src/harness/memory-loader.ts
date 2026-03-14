// ============================================================
// @oni.bot/core/harness — MemoryLoader
//
// Filesystem-native progressive disclosure memory.
// Five memory types across four token-budget tiers.
// Uses dynamic require('fs') — safe in non-Node environments.
// ============================================================

import type { ToolDefinition, ToolContext } from "../tools/types.js";

// ─── Lazy fs/path helpers ─────────────────────────────────────────────────

function getFs(): typeof import("fs") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("fs") as typeof import("fs");
  } catch {
    return null;
  }
}

function getPath(): typeof import("path") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("path") as typeof import("path");
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────

export type MemoryTier = 0 | 1 | 2 | 3;

export type MemoryType =
  | "identity"
  | "working"
  | "procedural"
  | "episodic"
  | "semantic"
  | "user";

export interface MemoryUnit {
  /** Relative path from memory root, e.g. "procedural/pptx/notes.md" */
  key: string;
  /** Absolute path on disk */
  path: string;
  type: MemoryType;
  tier: MemoryTier;
  /** From frontmatter; fallback: h2 headings + first-line keywords (≤5) */
  tags: string[];
  /** From frontmatter; fallback: first non-heading paragraph (≤120 chars) */
  summary: string;
  /** Math.ceil(content.length / 4) */
  tokenCost: number;
  /** Natural language patterns that trigger this unit */
  triggers: string[];
  /** ISO mtime */
  updatedAt: string;
  /** Absent after scan(); populated after hydrate() or persist() */
  content?: string;
}

export interface LoadResult {
  units: MemoryUnit[];
  totalTokens: number;
  budget: number;
  /** Candidates that exceeded the budget (content NOT hydrated) */
  dropped: MemoryUnit[];
}

export interface MemoryLoaderConfig {
  root: string;
  /** Default: { 0: 800, 1: 2000, 2: 4000, 3: 8000 } */
  budgets?: Partial<Record<MemoryTier, number>>;
  /** Days to keep episodic sessions in recent/ before archiving. Default: 7 */
  episodicRecentDays?: number;
  /** Auto-rebuild INDEX.md after every persist(). Default: true */
  autoIndex?: boolean;
  /** Minimum relevance score (0–1) for match()/query(). Default: 0.2 */
  matchThreshold?: number;
  debug?: boolean;
}

// ─── Internal ─────────────────────────────────────────────────────────────

interface Frontmatter {
  type?: MemoryType;
  tier?: MemoryTier;
  tags?: string[];
  summary?: string;
  triggers?: string[];
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const raw = match[1]!;
  const body = match[2]!;
  const meta: Frontmatter = {};

  for (const line of raw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (!key || !val) continue;

    switch (key) {
      case "type":     meta.type = val as MemoryType; break;
      case "tier": {
        const parsed = parseInt(val, 10);
        if (parsed >= 0 && parsed <= 3) meta.tier = parsed as MemoryTier;
        break;
      }
      case "tags":     meta.tags = val.split(",").map((t) => t.trim()).filter(Boolean); break;
      case "summary":  meta.summary = val; break;
      case "triggers": meta.triggers = val.split(",").map((t) => t.trim()).filter(Boolean); break;
    }
  }

  return { meta, body };
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function inferTypeFromPath(relPath: string): MemoryType {
  const top = relPath.split(/[\\/]/)[0] ?? "";
  const map: Record<string, MemoryType> = {
    identity: "identity",
    working: "working",
    procedural: "procedural",
    episodic: "episodic",
    semantic: "semantic",
    user: "user",
  };
  return map[top] ?? "semantic";
}

function inferTierFromPath(relPath: string, type: MemoryType): MemoryTier {
  if (type === "identity") return 0;
  if (type === "working") return 1;
  if (type === "user") return relPath.includes("RELATIONSHIPS") ? 2 : 1;
  if (type === "procedural") {
    if (relPath.endsWith("INDEX.md")) return 1;
    if (relPath.includes("examples")) return 3;
    return 2;
  }
  if (type === "episodic") {
    if (relPath.endsWith("INDEX.md")) return 1;
    if (relPath.includes("archive")) return 3;
    return 2;
  }
  if (type === "semantic") {
    const parts = relPath.split(/[\\/]/);
    // root INDEX.md: semantic/INDEX.md → 2 parts
    if (parts.length === 2 && parts[1] === "INDEX.md") return 1;
    // domain INDEX.md: semantic/<domain>/INDEX.md → 3 parts
    if (parts.length === 3 && parts[2] === "INDEX.md") return 2;
    return 3;
  }
  return 2;
}

const STOPWORDS = new Set([
  "the","and","for","are","but","not","you","all","can","had","her","was","one",
  "our","out","day","get","has","him","his","how","its","may","new","now","old",
  "see","two","who","did","does","into","than","that","this","with","have","from",
  "they","will","been","when","what","were","your","said","each","which","their",
  "time","about","would","there","could","other","after","first","these","those",
]);

// ─── MemoryLoader ─────────────────────────────────────────────────────────

export class MemoryLoader {
  private readonly config: Required<MemoryLoaderConfig>;
  private units: Map<string, MemoryUnit> = new Map();
  private loaded: Set<string> = new Set();

  private static readonly DEFAULT_BUDGETS: Record<MemoryTier, number> = {
    0: 800,
    1: 2000,
    2: 4000,
    3: 8000,
  };

  constructor(config: MemoryLoaderConfig) {
    this.config = {
      budgets: { ...MemoryLoader.DEFAULT_BUDGETS, ...config.budgets },
      episodicRecentDays: config.episodicRecentDays ?? 7,
      autoIndex: config.autoIndex ?? true,
      matchThreshold: config.matchThreshold ?? 0.2,
      debug: config.debug ?? false,
      root: config.root,
    };
    this.ensureDirectoryStructure();
    this.scan();
  }

  // ── Factory ──────────────────────────────────────────────────────────────

  static fromRoot(root: string, opts?: Partial<MemoryLoaderConfig>): MemoryLoader {
    return new MemoryLoader({ root, ...opts });
  }

  // ── Directory Bootstrap ──────────────────────────────────────────────────

  private ensureDirectoryStructure(): void {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return;

    const dirs = [
      "identity", "working", "user",
      "procedural", "episodic/recent", "episodic/archive", "semantic",
    ];
    for (const dir of dirs) {
      try {
        const full = path.join(this.config.root, dir);
        if (!fs.existsSync(full)) {
          fs.mkdirSync(full, { recursive: true });
        }
      } catch {
        // Silent degrade — non-Node environment
      }
    }
  }

  // ── Scanning ─────────────────────────────────────────────────────────────

  scan(): void {
    this.units.clear();
    const fs = getFs();
    const path = getPath();
    if (!fs || !path || !fs.existsSync(this.config.root)) return;
    this.scanDirectory(this.config.root, "", fs, path);
    this.log(`Scanned: ${this.units.size} memory units found`);
  }

  private scanDirectory(
    absDir: string,
    relDir: string,
    fs: typeof import("fs"),
    path: typeof import("path"),
  ): void {
    let entries: import("fs").Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // Skip INDEX.md — it is metadata, not a memory unit
      if (entry.name === "INDEX.md") continue;

      const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
      const absPath = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        this.scanDirectory(absPath, relPath, fs, path);
      } else if (entry.name.endsWith(".md")) {
        this.registerFile(absPath, relPath);
      }
    }
  }

  private registerFile(absPath: string, relPath: string): void {
    const fs = getFs();
    if (!fs) return;
    try {
      const raw = fs.readFileSync(absPath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const type = meta.type ?? inferTypeFromPath(relPath);
      const tier = meta.tier ?? inferTierFromPath(relPath, type);
      const stat = fs.statSync(absPath);

      const unit: MemoryUnit = {
        key: relPath,
        path: absPath,
        type,
        tier,
        tags: meta.tags ?? this.extractTagsFromContent(body),
        summary: meta.summary ?? this.extractSummary(body),
        tokenCost: estimateTokens(raw),
        triggers: meta.triggers ?? [],
        updatedAt: stat.mtime.toISOString(),
      };

      this.units.set(relPath, unit);
    } catch {
      // Skip unreadable files
    }
  }

  // ── Tag + Summary Extraction ──────────────────────────────────────────────

  private extractTagsFromContent(body: string): string[] {
    const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map(
      (m) => m[1]!.toLowerCase().replace(/\s+/g, "-"),
    );
    const firstLine = body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
    const words = firstLine.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
    return [...new Set([...headings, ...words.slice(0, 5)])];
  }

  private extractSummary(body: string): string {
    const firstParagraph = body.split("\n\n").find((p) => p.trim() && !p.startsWith("#"));
    if (!firstParagraph) return "";
    return firstParagraph.replace(/\n/g, " ").trim().slice(0, 120);
  }

  // ── Progressive Disclosure ────────────────────────────────────────────────

  /**
   * wake() — Load Tier 0 (identity). Always called first.
   * Additive: already-loaded units are skipped.
   */
  wake(): LoadResult {
    return this.loadByTier(0);
  }

  /**
   * orient() — Load Tier 1 (working, user/PROFILE, INDEX files).
   * Additive.
   */
  orient(): LoadResult {
    return this.loadByTier(1);
  }

  /**
   * match(task) — Load Tier 2 units relevant to the task string.
   * Scored by tag-overlap × recency. Additive.
   * Returns empty LoadResult if taskTokens is empty (no error).
   */
  match(task: string): LoadResult {
    const taskTags = this.extractTagsFromString(task);
    if (taskTags.length === 0) {
      return { units: [], totalTokens: 0, budget: this.getBudget(2), dropped: [] };
    }
    const budget = this.getBudget(2);
    const candidates = this.getUnitsByTier(2).filter((u) => !this.loaded.has(u.key));
    const scored = candidates
      .map((unit) => ({ unit, score: this.scoreRelevance(unit, taskTags) }))
      .filter(({ score }) => score > 0 && score >= this.config.matchThreshold)
      .sort((a, b) => b.score - a.score);
    return this.applyBudget(scored.map((s) => s.unit), budget);
  }

  /**
   * query(topic) — Load Tier 3 units. Called only via the memory_query tool.
   * Additive.
   */
  query(topic: string): LoadResult {
    const topicTags = this.extractTagsFromString(topic);
    if (topicTags.length === 0) {
      return { units: [], totalTokens: 0, budget: this.getBudget(3), dropped: [] };
    }
    const budget = this.getBudget(3);
    const candidates = this.getUnitsByTier(3).filter((u) => !this.loaded.has(u.key));
    const scored = candidates
      .map((unit) => ({ unit, score: this.scoreRelevance(unit, topicTags) }))
      .filter(({ score }) => score > 0 && score >= this.config.matchThreshold)
      .sort((a, b) => b.score - a.score);
    return this.applyBudget(scored.map((s) => s.unit), budget);
  }

  /**
   * load(key) — Directly load a specific memory unit by key. Additive.
   */
  load(key: string): MemoryUnit | null {
    const unit = this.units.get(key);
    if (!unit) return null;
    const hydrated = this.hydrate(unit);
    this.loaded.add(key);
    return hydrated;
  }

  /**
   * loadType(type) — Load all units of a given memory type.
   * Budget: 16000t fixed (intentional escape hatch). Additive.
   */
  loadType(type: MemoryType): LoadResult {
    const units = [...this.units.values()].filter((u) => u.type === type && !this.loaded.has(u.key));
    return this.applyBudget(units, 16000);
  }

  /**
   * buildSystemPrompt(tiers) — Assemble loaded units into a system prompt string.
   * Default tiers: [0, 1, 2]
   */
  buildSystemPrompt(tiers: MemoryTier[] = [0, 1, 2]): string {
    const sections: string[] = [];
    for (const [key, unit] of this.units) {
      if (!this.loaded.has(key)) continue;
      if (!tiers.includes(unit.tier)) continue;
      if (!unit.content) continue;
      const header = `\n\n<!-- MEMORY: ${unit.type.toUpperCase()} | ${unit.key} | T${unit.tier} -->\n`;
      sections.push(header + unit.content);
    }
    return sections.join("");
  }

  /**
   * getLoadedManifest() — Compact list of loaded keys + costs.
   * Format: "- <key> (T<tier>, <cost>t)" per line.
   */
  getLoadedManifest(): string {
    return [...this.loaded]
      .map((key) => {
        const unit = this.units.get(key);
        return unit ? `- ${key} (T${unit.tier}, ${unit.tokenCost}t)` : `- ${key}`;
      })
      .join("\n");
  }

  /** resetSession() — Clear loaded set and release hydrated content. Does not remove files. */
  resetSession(): void {
    this.loaded.clear();
    for (const unit of this.units.values()) {
      unit.content = undefined;
    }
    this.log("Session reset");
  }

  // ── Write API ─────────────────────────────────────────────────────────────

  /**
   * persist() — Write a memory unit to disk.
   * autoIndex: rebuildIndex() called synchronously before return when autoIndex === true.
   * Returns MemoryUnit with content populated.
   */
  persist(
    type: MemoryType,
    filename: string,
    content: string,
    subfolder?: string,
  ): MemoryUnit {
    return this.persistInternal(type, filename, content, subfolder, false);
  }

  private persistInternal(
    type: MemoryType,
    filename: string,
    content: string,
    subfolder: string | undefined,
    skipAutoIndex: boolean,
  ): MemoryUnit {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) {
      // Silent degrade in non-Node environments — return a stub unit.
      // Must NOT throw: callers (persistEpisodic, finally block) do not wrap this.
      return {
        key: `${type}/${filename}`,
        path: "",
        type,
        tier: 1 as MemoryTier,
        tags: [],
        summary: "",
        tokenCost: 0,
        triggers: [],
        updatedAt: new Date().toISOString(),
        content,
      };
    }

    const folder = subfolder
      ? path.join(this.config.root, type, subfolder)
      : path.join(this.config.root, type);

    const absPath = path.join(folder, filename);
    const relPath = path.relative(this.config.root, absPath);

    const finalContent = /^---\r?\n/.test(content)
      ? content
      : this.injectFrontmatter(content, type, relPath);

    try {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(absPath, finalContent, "utf-8");
    } catch {
      // Must NOT throw: called from finally blocks — return a stub on I/O failure.
      return {
        key: relPath,
        path: absPath,
        type,
        tier: inferTierFromPath(relPath, type),
        tags: [],
        summary: "",
        tokenCost: estimateTokens(finalContent),
        triggers: [],
        updatedAt: new Date().toISOString(),
        content: finalContent,
      };
    }
    this.registerFile(absPath, relPath);

    const unit = this.units.get(relPath);
    if (!unit) {
      // registerFile silently failed (e.g. post-write permission error) — return minimal stub
      return {
        key: relPath,
        path: absPath,
        type,
        tier: inferTierFromPath(relPath, type),
        tags: [],
        summary: "",
        tokenCost: estimateTokens(finalContent),
        triggers: [],
        updatedAt: new Date().toISOString(),
        content: finalContent,
      };
    }
    unit.content = finalContent;

    if (this.config.autoIndex && !skipAutoIndex) {
      this.rebuildIndex(path.dirname(absPath));
    }

    this.log(`Persisted: ${relPath} (${unit.tokenCost}t)`);
    return unit;
  }

  /**
   * persistEpisodic() — Write session log to episodic/recent/<date>_<sessionId>.md.
   * Triggers compaction if recent/ has files older than episodicRecentDays.
   */
  persistEpisodic(sessionId: string, content: string): MemoryUnit {
    const date = new Date().toISOString().split("T")[0]!;
    const filename = `${date}_${sessionId}.md`;
    // Skip autoIndex for episodic/recent — INDEX.md would pollute the dated file listing
    const unit = this.persistInternal("episodic", filename, content, "recent", true);
    this.compactEpisodicIfNeeded();
    return unit;
  }

  /**
   * persistSemantic() — Write knowledge unit to semantic/<domain>/<topic>.md.
   * Rebuilds both domain INDEX.md and root semantic INDEX.md.
   */
  persistSemantic(domain: string, topic: string, content: string): MemoryUnit {
    const path = getPath();
    const filename = `${topic.toLowerCase().replace(/\s+/g, "-")}.md`;
    const unit = this.persist("semantic", filename, content, domain);

    if (this.config.autoIndex && path) {
      this.rebuildIndex(path.join(this.config.root, "semantic"));
    }

    return unit;
  }

  // ── INDEX.md Management ───────────────────────────────────────────────────

  /**
   * rebuildIndex() — Rewrite the INDEX.md for a given folder.
   * INDEX.md files are write-only — never read back by the loader.
   */
  rebuildIndex(folder: string): void {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return;

    const relFolder = path.relative(this.config.root, folder);
    const folderPrefix = folder.endsWith(path.sep) ? folder : folder + path.sep;
    const units = [...this.units.values()].filter(
      (u) => u.path.startsWith(folderPrefix),
    );

    if (units.length === 0) return;

    const rows = units
      .map(
        (u) =>
          `| ${path.basename(u.key)} | ${u.summary.slice(0, 60)} | ${u.tags.slice(0, 4).join(",")} | T${u.tier} | ${u.tokenCost} |`,
      )
      .join("\n");

    const allTags = [...new Set(units.flatMap((u) => u.tags))].slice(0, 8).join(", ");

    const index = [
      `---`,
      `type: index`,
      `folder: ${relFolder}`,
      `indexed_at: ${new Date().toISOString()}`,
      `---`,
      ``,
      `# Index: ${relFolder || "root"}`,
      `_token_budget: 200_`,
      ``,
      `## Contents`,
      ``,
      `| file | summary | tags | tier | tokens |`,
      `|------|---------|------|------|--------|`,
      rows,
      ``,
      `## Routing Hints`,
      ``,
      `- Load this folder when: ${allTags}`,
      `- Units: ${units.length} | Total tokens: ${units.reduce((s, u) => s + u.tokenCost, 0)}`,
    ].join("\n");

    try {
      fs.writeFileSync(path.join(folder, "INDEX.md"), index, "utf-8");
      this.log(`Rebuilt INDEX.md: ${relFolder}`);
    } catch {
      // Silent degrade
    }
  }

  /** rebuildAllIndexes() — Rebuild every INDEX.md in the tree. */
  rebuildAllIndexes(): void {
    const path = getPath();
    if (!path) return;
    const dirs = new Set<string>();
    for (const unit of this.units.values()) {
      dirs.add(path.dirname(unit.path));
    }
    for (const dir of dirs) {
      this.rebuildIndex(dir);
    }
  }

  // ── Diagnostic ────────────────────────────────────────────────────────────

  stats(): {
    totalUnits: number;
    currentlyLoaded: number;
    totalTokensOnDisk: number;
    byType: Record<string, number>;
    byTier: Record<string, number>;
    root: string;
  } {
    const byType: Record<string, number> = {};
    const byTier: Record<string, number> = {};
    let totalTokens = 0;

    for (const unit of this.units.values()) {
      byType[unit.type] = (byType[unit.type] ?? 0) + 1;
      byTier[`T${unit.tier}`] = (byTier[`T${unit.tier}`] ?? 0) + 1;
      totalTokens += unit.tokenCost;
    }

    return {
      totalUnits: this.units.size,
      currentlyLoaded: this.loaded.size,
      totalTokensOnDisk: totalTokens,
      byType,
      byTier,
      root: this.config.root,
    };
  }

  // ── Tool ─────────────────────────────────────────────────────────────────

  /**
   * getQueryTool() — Returns the memory_query ToolDefinition.
   * The `reason` param is prompting-only — not used in execute logic.
   * `_ctx` is typed as ToolContext (base); MemoryLoader needs no harness-specific context.
   */
  getQueryTool(): ToolDefinition<{ topic: string; reason: string }, object> {
    return {
      name: "memory_query",
      description: `Retrieve deep knowledge from memory when you hit a gap mid-task.
Call this when: you need a specific procedure, domain fact, or past decision you don't currently have in context.
Do NOT call this speculatively — only when you've identified a concrete gap.
Returns: matching memory units or empty if nothing found.`,
      schema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "Specific topic, skill name, or domain concept to retrieve. Be precise.",
          },
          reason: {
            type: "string",
            description: "One sentence: what gap are you filling and why do you need it now.",
          },
        },
        required: ["topic", "reason"],
        additionalProperties: false,
      },
      execute: (input: { topic: string; reason: string }, _ctx: ToolContext): object => {
        // reason intentionally unused — prompting-only
        const result = this.query(input.topic);
        if (result.units.length === 0) {
          return {
            found: false,
            topic: input.topic,
            message: "No matching memory found. Proceed with available context or escalate.",
          };
        }
        return {
          found: true,
          units: result.units.map((u) => ({ key: u.key, content: u.content })),
          totalTokens: result.totalTokens,
          droppedCount: result.dropped.length,
        };
      },
    };
  }

  // ── Internal Helpers ──────────────────────────────────────────────────────

  private loadByTier(tier: MemoryTier): LoadResult {
    const budget = this.getBudget(tier);
    const units = this.getUnitsByTier(tier).filter((u) => !this.loaded.has(u.key));
    return this.applyBudget(units, budget);
  }

  private getUnitsByTier(tier: MemoryTier): MemoryUnit[] {
    return [...this.units.values()].filter((u) => u.tier === tier);
  }

  private getBudget(tier: MemoryTier): number {
    return (this.config.budgets as Record<MemoryTier, number>)[tier];
  }

  private applyBudget(units: MemoryUnit[], budget: number): LoadResult {
    const selected: MemoryUnit[] = [];
    const dropped: MemoryUnit[] = [];
    let used = 0;

    for (const unit of units) {
      if (used + unit.tokenCost <= budget) {
        selected.push({ ...this.hydrate(unit) });
        this.loaded.add(unit.key);
        used += unit.tokenCost;
      } else {
        dropped.push(unit);
      }
    }

    this.log(`Loaded ${selected.length} units (${used}/${budget}t). Dropped: ${dropped.length}`);
    return { units: selected, totalTokens: used, budget, dropped };
  }

  private hydrate(unit: MemoryUnit): MemoryUnit {
    if (unit.content) return unit;
    const fs = getFs();
    if (!fs) { unit.content = `<!-- Failed to read: ${unit.path} -->`; return unit; }
    try {
      unit.content = fs.readFileSync(unit.path, "utf-8");
    } catch {
      unit.content = `<!-- Failed to read: ${unit.path} -->`;
    }
    return unit;
  }

  private scoreRelevance(unit: MemoryUnit, taskTags: string[]): number {
    const unitTagSet = new Set([...unit.tags, ...unit.triggers]);
    const overlap = taskTags.filter((t) => unitTagSet.has(t)).length;
    const tagScore = overlap / Math.max(taskTags.length, 1);

    const rawAge = Date.now() - new Date(unit.updatedAt).getTime();
    const ageMs = isNaN(rawAge) ? 0 : rawAge;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyScore = unit.type === "episodic" ? Math.max(0, 1 - ageDays / 30) : 0;

    return tagScore * 0.8 + recencyScore * 0.2;
  }

  private extractTagsFromString(text: string): string[] {
    return (
      text
        .toLowerCase()
        .match(/\b[a-z]{3,}\b/g)
        ?.filter((w) => !STOPWORDS.has(w))
        .slice(0, 20) ?? []
    );
  }

  private injectFrontmatter(content: string, type: MemoryType, relPath: string): string {
    const tier = inferTierFromPath(relPath, type);
    const tags = this.extractTagsFromContent(content);
    const summary = this.extractSummary(content);

    return [
      "---",
      `type: ${type}`,
      `tier: ${tier}`,
      `tags: ${tags.join(", ")}`,
      `summary: ${summary.slice(0, 100)}`,
      `created: ${new Date().toISOString()}`,
      "---",
      "",
      content,
    ].join("\n");
  }

  private compactEpisodicIfNeeded(): void {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return;

    const recentDir = path.join(this.config.root, "episodic", "recent");
    const archiveDir = path.join(this.config.root, "episodic", "archive");

    if (!fs.existsSync(recentDir)) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.episodicRecentDays);

    let files: string[];
    try {
      files = fs.readdirSync(recentDir).filter((f) => f.endsWith(".md"));
    } catch {
      return;
    }

    let archived = false;
    for (const file of files) {
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;

      // Parse as local-time midnight to match the local-time cutoff.
      // new Date("YYYY-MM-DD") parses as UTC midnight which is off by up to
      // ±24h relative to the local-time cutoff in non-UTC timezones.
      const [y, m, d] = dateMatch[1]!.split("-").map(Number);
      const fileDate = new Date(y!, m! - 1, d!);
      if (fileDate < cutoff) {
        try {
          const src = path.join(recentDir, file);
          const dest = path.join(archiveDir, file);
          fs.mkdirSync(archiveDir, { recursive: true });
          fs.renameSync(src, dest);

          const oldKey = path.relative(this.config.root, src);
          const newKey = path.relative(this.config.root, dest);
          this.units.delete(oldKey);
          this.registerFile(dest, newKey);
          this.log(`Archived episodic: ${file}`);
          archived = true;
        } catch {
          // Skip if move fails
        }
      }
    }

    if (archived && this.config.autoIndex) {
      this.rebuildIndex(recentDir);
      this.rebuildIndex(archiveDir);
    }
  }

  private log(msg: string): void {
    if (this.config.debug) console.log(`[MemoryLoader] ${msg}`);
  }
}
