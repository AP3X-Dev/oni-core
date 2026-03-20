// ============================================================
// @oni.bot/core/harness/memory — ranker
//
// Semantic relevance ranking and token budget enforcement.
// ============================================================

import type { MemoryTier, MemoryUnit, LoadResult } from "./types.js";

// ─── Stopwords ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the","and","for","are","but","not","you","all","can","had","her","was","one",
  "our","out","day","get","has","him","his","how","its","may","new","now","old",
  "see","two","who","did","does","into","than","that","this","with","have","from",
  "they","will","been","when","what","were","your","said","each","which","their",
  "time","about","would","there","could","other","after","first","these","those",
]);

// ─── Tag extraction ───────────────────────────────────────────────────────────

export function extractTagsFromString(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/\b[a-z]{3,}\b/g)
      ?.filter((w) => !STOPWORDS.has(w))
      .slice(0, 20) ?? []
  );
}

// ─── Relevance scoring ────────────────────────────────────────────────────────

export function scoreRelevance(unit: MemoryUnit, taskTags: string[]): number {
  const unitTagSet = new Set([...unit.tags, ...unit.triggers]);
  const overlap = taskTags.filter((t) => unitTagSet.has(t)).length;
  const tagScore = overlap / Math.max(taskTags.length, 1);

  const rawAge = Date.now() - new Date(unit.updatedAt).getTime();
  const ageMs = isNaN(rawAge) ? 0 : rawAge;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyScore = unit.type === "episodic" ? Math.max(0, 1 - ageDays / 30) : 1;

  return tagScore * 0.8 + recencyScore * 0.2;
}

// ─── Budget enforcement ───────────────────────────────────────────────────────

/**
 * Apply token budget to a list of candidate units.
 * Hydrates selected units via the provided hydrate function.
 * Returns a LoadResult with selected units + dropped overflow.
 */
export function applyBudget(
  units: MemoryUnit[],
  budget: number,
  hydrateUnit: (unit: MemoryUnit) => MemoryUnit,
  markLoaded: (key: string) => void,
  logFn: (msg: string) => void,
): LoadResult {
  const selected: MemoryUnit[] = [];
  const dropped: MemoryUnit[] = [];
  let used = 0;

  for (const unit of units) {
    if (used + unit.tokenCost <= budget) {
      selected.push({ ...hydrateUnit(unit) });
      markLoaded(unit.key);
      used += unit.tokenCost;
    } else {
      dropped.push(unit);
    }
  }

  logFn(`Loaded ${selected.length} units (${used}/${budget}t). Dropped: ${dropped.length}`);
  return { units: selected, totalTokens: used, budget, dropped };
}

// ─── Ranked query ─────────────────────────────────────────────────────────────

/**
 * Rank candidates by relevance to a task string, filter by threshold,
 * apply budget, and return the LoadResult.
 */
export function rankAndLoad(
  task: string,
  tier: MemoryTier,
  matchThreshold: number,
  candidates: MemoryUnit[],
  budget: number,
  hydrateUnit: (unit: MemoryUnit) => MemoryUnit,
  markLoaded: (key: string) => void,
  logFn: (msg: string) => void,
): LoadResult {
  const taskTags = extractTagsFromString(task);
  if (taskTags.length === 0) {
    logFn(`[memory-ranker] No extractable tags from task "${task}" — skipping memory load`);
    return { units: [], totalTokens: 0, budget, dropped: [] };
  }

  const scored = candidates
    .map((unit) => ({ unit, score: scoreRelevance(unit, taskTags) }))
    .filter(({ score }) => score > 0 && score > matchThreshold)
    .sort((a, b) => b.score - a.score);

  return applyBudget(scored.map((s) => s.unit), budget, hydrateUnit, markLoaded, logFn);
}
