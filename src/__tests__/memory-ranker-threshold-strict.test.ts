import { describe, it, expect } from "vitest";
import { rankAndLoad, scoreRelevance } from "../harness/memory/ranker.js";
import type { MemoryUnit } from "../harness/memory/types.js";

/**
 * Regression test for BUG-0273.
 *
 * The relevance filter in rankAndLoad() used `score >= matchThreshold` which
 * allowed non-episodic units with zero tag overlap to pass when the threshold
 * was exactly 0.2.
 *
 * Non-episodic units always have recencyScore=1 (they don't decay over time).
 * With zero tag overlap:  score = 0*0.8 + 1*0.2 = 0.2
 *
 * With `>= 0.2` the unit passed. With the fixed `> 0.2` it is excluded.
 */

function makeUnit(overrides: Partial<MemoryUnit> = {}): MemoryUnit {
  return {
    key: "test/unit.md",
    path: "/memory/test/unit.md",
    type: "semantic",
    tier: 1,
    tags: ["unrelated", "different"],
    triggers: [],
    summary: "Unrelated content",
    tokenCost: 10,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const noop = () => {};

describe("BUG-0273: rankAndLoad uses strict > threshold, not >=", () => {
  it("scoreRelevance returns exactly 0.2 for a non-episodic unit with zero tag overlap", () => {
    const unit = makeUnit({ type: "semantic", tags: ["zebra", "tango"], triggers: [] });
    // Task tags will be ["apple", "banana"] — no overlap with unit tags
    const taskTags = ["apple", "banana"];
    const score = scoreRelevance(unit, taskTags);
    // tagScore = 0/2 = 0; recencyScore = 1 (non-episodic)
    // score = 0*0.8 + 1*0.2 = 0.2
    expect(score).toBeCloseTo(0.2, 10);
  });

  it("excludes a non-episodic unit whose score equals the matchThreshold (boundary case)", () => {
    // This was the regression: with >= the unit passed; with > it must be excluded.
    const unit = makeUnit({
      type: "semantic",
      tags: ["zebra", "tango"],
      triggers: [],
      tokenCost: 10,
    });

    const result = rankAndLoad(
      "apple banana",   // task — no overlap with unit tags
      1,                // tier (unused by rankAndLoad directly)
      0.2,              // matchThreshold — unit scores exactly 0.2
      [unit],
      1000,             // budget
      (u) => u,         // hydrateUnit
      noop,             // markLoaded
      noop,             // logFn
    );

    // The unit's score is exactly 0.2 === matchThreshold.
    // With the fixed strict > comparison, it must be excluded.
    expect(result.units).toHaveLength(0);
  });

  it("includes a unit whose score is strictly above the matchThreshold", () => {
    // Unit tags overlap with task: tagScore > 0, so total score > 0.2
    const unit = makeUnit({
      type: "semantic",
      tags: ["apple", "unrelated"],
      triggers: [],
      tokenCost: 10,
    });

    const result = rankAndLoad(
      "apple banana",   // task — "apple" overlaps
      1,
      0.2,              // matchThreshold
      [unit],
      1000,
      (u) => u,
      noop,
      noop,
    );

    // tagScore = 1/2 = 0.5; score = 0.5*0.8 + 1*0.2 = 0.6 > 0.2 → included
    expect(result.units).toHaveLength(1);
    expect(result.units[0]!.key).toBe("test/unit.md");
  });

  it("includes an episodic unit that scores above threshold through recency alone", () => {
    // A freshly-updated episodic unit with some tag overlap should still be
    // included so the fix does not over-restrict episodic memory.
    const unit = makeUnit({
      type: "episodic",
      tags: ["apple"],
      triggers: [],
      tokenCost: 5,
      updatedAt: new Date().toISOString(), // very recent → recencyScore ≈ 1
    });

    const result = rankAndLoad(
      "apple task",
      0,
      0.2,
      [unit],
      1000,
      (u) => u,
      noop,
      noop,
    );

    // tagScore = 1/2 = 0.5; recencyScore ≈ 1; score ≈ 0.6 > 0.2 → included
    expect(result.units).toHaveLength(1);
  });
});
