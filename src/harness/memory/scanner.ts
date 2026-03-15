// ============================================================
// @oni.bot/core/harness/memory — scanner
//
// Filesystem scan, frontmatter parsing, tag/summary inference,
// and token cost estimation.
// Uses getFs()/getPath() from fs-compat.ts — never top-level fs imports.
// ============================================================

import { getFs, getPath } from "./fs-compat.js";
import type { MemoryTier, MemoryType, MemoryUnit, Frontmatter } from "./types.js";

// ─── Frontmatter ─────────────────────────────────────────────────────────────

export function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
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

// ─── Token estimation ─────────────────────────────────────────────────────────

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

// ─── Path-based type/tier inference ──────────────────────────────────────────

export function inferTypeFromPath(relPath: string): MemoryType {
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

export function inferTierFromPath(relPath: string, type: MemoryType): MemoryTier {
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

// ─── Tag + summary extraction ─────────────────────────────────────────────────

export function extractTagsFromContent(body: string): string[] {
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map(
    (m) => m[1]!.toLowerCase().replace(/\s+/g, "-"),
  );
  const firstLine = body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
  const words = firstLine.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
  return [...new Set([...headings, ...words.slice(0, 5)])];
}

export function extractSummary(body: string): string {
  const firstParagraph = body.split("\n\n").find((p) => p.trim() && !p.startsWith("#"));
  if (!firstParagraph) return "";
  return firstParagraph.replace(/\n/g, " ").trim().slice(0, 120);
}

// ─── File registration ────────────────────────────────────────────────────────

/**
 * Read a single markdown file from disk and build a MemoryUnit.
 * Returns null if the file cannot be read.
 */
export function registerFile(absPath: string, relPath: string): MemoryUnit | null {
  const fs = getFs();
  if (!fs) return null;
  try {
    const raw = fs.readFileSync(absPath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    const type = meta.type ?? inferTypeFromPath(relPath);
    const tier = meta.tier ?? inferTierFromPath(relPath, type);
    const stat = fs.statSync(absPath);

    return {
      key: relPath,
      path: absPath,
      type,
      tier,
      tags: meta.tags ?? extractTagsFromContent(body),
      summary: meta.summary ?? extractSummary(body),
      tokenCost: estimateTokens(raw),
      triggers: meta.triggers ?? [],
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Directory scan ───────────────────────────────────────────────────────────

/**
 * Recursively scan a directory for .md files (skipping INDEX.md).
 * Returns a map of relPath → MemoryUnit for all successfully registered files.
 */
export function scanDirectory(
  absDir: string,
  relDir: string,
  fs: typeof import("fs"),
  path: typeof import("path"),
): Map<string, MemoryUnit> {
  const result = new Map<string, MemoryUnit>();

  let entries: import("fs").Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    // Skip INDEX.md — it is metadata, not a memory unit
    if (entry.name === "INDEX.md") continue;

    const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
    const absPath = path.join(absDir, entry.name);

    if (entry.isDirectory()) {
      const sub = scanDirectory(absPath, relPath, fs, path);
      for (const [k, v] of sub) result.set(k, v);
    } else if (entry.name.endsWith(".md")) {
      const unit = registerFile(absPath, relPath);
      if (unit) result.set(relPath, unit);
    }
  }

  return result;
}

/**
 * Scan the memory root directory and return all discovered MemoryUnits.
 * Returns an empty map if fs/path are unavailable or root doesn't exist.
 */
export function scanRoot(root: string): Map<string, MemoryUnit> {
  const fs = getFs();
  const path = getPath();
  if (!fs || !path || !fs.existsSync(root)) return new Map();
  return scanDirectory(root, "", fs, path);
}
