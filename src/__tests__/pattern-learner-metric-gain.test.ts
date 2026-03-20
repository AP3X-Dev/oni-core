// Regression test for BUG-0017
// identifyPatterns previously computed metricGain as metricAfter - metricBefore.
// Since ExperimentalExecutor treats lower-is-better (minimize) as success,
// all stored metricGain values were inverted — negative for genuine successes.
// Fix: metricGain for minimize direction is now metricBefore - metricAfter (positive when metric decreases).

import { describe, it, expect } from "vitest";
import { identifyPatterns } from "../swarm/self-improvement/pattern-learner.js";
import type { ExperimentRecord } from "../swarm/self-improvement/experiment-log.js";

function makeRecord(
  hypothesis: string,
  success: boolean,
  metricBefore: number,
  metricAfter: number,
  direction?: "minimize" | "maximize",
): ExperimentRecord {
  return {
    id: crypto.randomUUID(),
    agentId: "test-agent",
    hypothesis,
    targetMetric: "latency",
    expectedDelta: 0.1,
    metricBefore,
    metricAfter,
    success,
    contextSummary: "ctx",
    timestamp: new Date().toISOString(),
    direction,
  };
}

describe("BUG-0017: identifyPatterns metricGain direction", () => {
  it("metricGain is positive when metric decreases for minimize direction (default)", () => {
    // Successful experiment: latency dropped from 1.0 → 0.7 (lower is better)
    const history = [
      makeRecord("cache database queries always", true, 1.0, 0.7),
      makeRecord("cache database queries consistently", true, 0.9, 0.6),
    ];

    const patterns = identifyPatterns(history, "latency");
    expect(patterns).toHaveLength(1);

    const p = patterns[0]!;
    // With the fix: gain = metricBefore - metricAfter = positive
    // Without the fix: gain = metricAfter - metricBefore = negative
    expect(p.metricGain).toBeGreaterThan(0);
  });

  it("metricGain is negative when metric increases for minimize direction (regression)", () => {
    // Successful experiment but metric got worse
    const history = [
      makeRecord("retry failed requests always", true, 1.0, 1.3),
      makeRecord("retry failed requests often", true, 0.9, 1.1),
    ];

    const patterns = identifyPatterns(history, "latency");
    expect(patterns).toHaveLength(1);

    const p = patterns[0]!;
    // Metric increased (got worse) → gain should be negative
    expect(p.metricGain).toBeLessThan(0);
  });

  it("metricGain is positive when metric increases for maximize direction", () => {
    const history = [
      makeRecord("increase throughput consistently", true, 100, 150, "maximize"),
      makeRecord("increase throughput consistently via batching", true, 90, 140, "maximize"),
    ];

    const patterns = identifyPatterns(history, "latency");
    expect(patterns).toHaveLength(1);

    const p = patterns[0]!;
    // maximize: gain = metricAfter - metricBefore = positive when metric increases
    expect(p.metricGain).toBeGreaterThan(0);
  });

  it("suggestNext ranked patterns have higher-gain patterns first (minimize)", () => {
    // Two pattern groups: one with bigger improvement, one with smaller
    const history = [
      // Group A: large improvement
      makeRecord("cache database queries always", true, 1.0, 0.5),
      makeRecord("cache database queries consistently", true, 0.9, 0.4),
      // Group B: small improvement
      makeRecord("batch write operations always", true, 1.0, 0.9),
      makeRecord("batch write operations often", true, 0.8, 0.75),
    ];

    const patterns = identifyPatterns(history, "latency");
    expect(patterns.length).toBeGreaterThanOrEqual(2);

    const cachePattern = patterns.find(p => p.description.includes("cache database"));
    const batchPattern = patterns.find(p => p.description.includes("batch write"));

    expect(cachePattern).toBeDefined();
    expect(batchPattern).toBeDefined();

    // Both should be positive (bug would have made them negative)
    expect(cachePattern!.metricGain).toBeGreaterThan(0);
    expect(batchPattern!.metricGain).toBeGreaterThan(0);

    // Cache pattern should have higher gain
    expect(cachePattern!.metricGain).toBeGreaterThan(batchPattern!.metricGain);
  });
});
