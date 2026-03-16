// ============================================================
// @oni.bot/core/harness/memory — MemoryLoader
//
// Integration class wiring scanner, ranker, and prompter modules.
// All 20+ public methods are preserved here.
//
// NOTE: This file is 594 lines — exceeds the 500-line guideline.
// Exception: the MemoryLoader class has 20+ public methods that
// must live on a single class for test spying (vi.spyOn) and the
// static fromRoot() factory pattern. Further decomposition would
// require breaking the public API.
// ============================================================

import type { ToolDefinition, ToolContext } from "../../tools/types.js";

import { getFs, getPath } from "./fs-compat.js";
import {
  estimateTokens,
  inferTierFromPath,
  extractTagsFromContent,
  extractSummary,
  registerFile,
  scanRoot,
} from "./scanner.js";
import { applyBudget, rankAndLoad } from "./ranker.js";
import { buildSystemPrompt } from "./prompter.js";

export * from "./types.js";

import type {
  MemoryTier,
  MemoryType,
  MemoryUnit,
  LoadResult,
  MemoryLoaderConfig,
} from "./types.js";

// ─── MemoryLoader ─────────────────────────────────────────────────────────────

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
    const scanned = scanRoot(this.config.root);
    for (const [k, v] of scanned) this.units.set(k, v);
    this.log(`Scanned: ${this.units.size} memory units found`);
  }

  private registerFileSelf(absPath: string, relPath: string): void {
    const unit = registerFile(absPath, relPath);
    if (unit) this.units.set(relPath, unit);
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
    const budget = this.getBudget(2);
    const candidates = this.getUnitsByTier(2).filter((u) => !this.loaded.has(u.key));
    return rankAndLoad(
      task, 2, this.config.matchThreshold, candidates, budget,
      (u) => this.hydrate(u),
      (key) => this.loaded.add(key),
      (msg) => this.log(msg),
    );
  }

  /**
   * query(topic) — Load Tier 3 units. Called only via the memory_query tool.
   * Additive.
   */
  query(topic: string): LoadResult {
    const budget = this.getBudget(3);
    const candidates = this.getUnitsByTier(3).filter((u) => !this.loaded.has(u.key));
    return rankAndLoad(
      topic, 3, this.config.matchThreshold, candidates, budget,
      (u) => this.hydrate(u),
      (key) => this.loaded.add(key),
      (msg) => this.log(msg),
    );
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
    return applyBudget(
      units, 16000,
      (u) => this.hydrate(u),
      (key) => this.loaded.add(key),
      (msg) => this.log(msg),
    );
  }

  /**
   * buildSystemPrompt(tiers) — Assemble loaded units into a system prompt string.
   * Default tiers: [0, 1, 2]
   */
  buildSystemPrompt(tiers: MemoryTier[] = [0, 1, 2]): string {
    return buildSystemPrompt(this.units, this.loaded, tiers);
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

    const root = path.resolve(this.config.root);
    const folder = subfolder
      ? path.resolve(this.config.root, type, subfolder)
      : path.resolve(this.config.root, type);

    const absPath = path.resolve(folder, filename);
    if (!absPath.startsWith(root + "/") && absPath !== root) {
      throw new Error(`Path traversal detected: resolved path escapes memory root`);
    }
    const relPath = path.relative(root, absPath);

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
    this.registerFileSelf(absPath, relPath);

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
    const safeSessionId = sessionId.replace(/\.\./g, "_").replace(/[\/\\]/g, "_").replace(/\x00/g, "_");
    const filename = `${date}_${safeSessionId}.md`;
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
    const safeDomain = domain.replace(/\.\./g, '_').replace(/[\/\\]/g, '_').replace(/\x00/g, '_');
    const safeTopic = topic.replace(/\.\./g, '_').replace(/[\/\\]/g, '_').replace(/\x00/g, '_');
    const filename = `${safeTopic.toLowerCase().replace(/\s+/g, "-")}.md`;
    const unit = this.persist("semantic", filename, content, safeDomain);

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
    return applyBudget(
      units, budget,
      (u) => this.hydrate(u),
      (key) => this.loaded.add(key),
      (msg) => this.log(msg),
    );
  }

  private getUnitsByTier(tier: MemoryTier): MemoryUnit[] {
    return [...this.units.values()].filter((u) => u.tier === tier);
  }

  private getBudget(tier: MemoryTier): number {
    return (this.config.budgets as Record<MemoryTier, number>)[tier];
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

  private injectFrontmatter(content: string, type: MemoryType, relPath: string): string {
    const tier = inferTierFromPath(relPath, type);
    const tags = extractTagsFromContent(content);
    const summary = extractSummary(content);

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
          this.registerFileSelf(dest, newKey);
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
