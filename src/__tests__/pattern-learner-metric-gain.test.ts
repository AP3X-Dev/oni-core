import { describe, it, expect } from "vitest";
import { identifyPatterns } from "../swarm/self-improvement/pattern-learner.js";
import type { ExperimentRecord } from "../swarm/self-improvement/experiment-log.js";

function makeRecord(overrides: Partial<ExperimentRecord>): ExperimentRecord {
  return {
    id: "exp-1",
    agentId: "agent-1",
    hypothesis: "reduce token usage by pruning",
    targetMetric: "latency",
    expectedDelta: -10,
    metricBefore: 100,
    metricAfter: 80,
    success: true,
    contextSummary: "test",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("BUG-0017: identifyPatterns computes metricGain with correct sign", () => {
  it("BUG-0017: should produce positive metricGain when metric decreases (minimize direction)", () => {
    const records: ExperimentRecord[] = [
      makeRecord({ id: "1", metricBefore: 100, metricAfter: 80, success: true }),
      makeRecord({ id: "2", metricBefore: 90, metricAfter: 70, success: true }),
    ];

    const patterns = identifyPatterns(records, "latency");

    expect(patterns).toHaveLength(1);
    // metricBefore - metricAfter = 20 for both → avg gain = 20 (positive = good)
    expect(patterns[0].metricGain).toBe(20);
    expect(patterns[0].metricGain).toBeGreaterThan(0);
  });

  it("BUG-0017: should produce positive metricGain when metric increases (maximize direction)", () => {
    const records: ExperimentRecord[] = [
      makeRecord({ id: "1", metricBefore: 50, metricAfter: 80, success: true, direction: "maximize" }),
      makeRecord({ id: "2", metricBefore: 60, metricAfter: 90, success: true, direction: "maximize" }),
    ];

    const patterns = identifyPatterns(records, "latency");

    expect(patterns).toHaveLength(1);
    // metricAfter - metricBefore = 30 for both → avg gain = 30 (positive = good)
    expect(patterns[0].metricGain).toBe(30);
    expect(patterns[0].metricGain).toBeGreaterThan(0);
  });
});
