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

describe("BUG-0052: identifyPatterns gain computation is direction-aware", () => {
  it("BUG-0052: minimize direction (default) yields positive gain when metric decreases", () => {
    const records: ExperimentRecord[] = [
      makeRecord({ id: "1", metricBefore: 100, metricAfter: 70, success: true }),
      makeRecord({ id: "2", metricBefore: 90, metricAfter: 60, success: true }),
    ];

    const patterns = identifyPatterns(records, "latency");

    expect(patterns).toHaveLength(1);
    // minimize: gain = metricBefore - metricAfter = 30 for both → avg = 30
    expect(patterns[0]!.metricGain).toBe(30);
    expect(patterns[0]!.metricGain).toBeGreaterThan(0);
  });

  it("BUG-0052: maximize direction yields positive gain when metric increases", () => {
    const records: ExperimentRecord[] = [
      makeRecord({ id: "1", metricBefore: 50, metricAfter: 80, success: true, direction: "maximize" }),
      makeRecord({ id: "2", metricBefore: 60, metricAfter: 95, success: true, direction: "maximize" }),
    ];

    const patterns = identifyPatterns(records, "latency");

    expect(patterns).toHaveLength(1);
    // maximize: gain = metricAfter - metricBefore = 30, 35 → avg = 32.5
    expect(patterns[0]!.metricGain).toBeCloseTo(32.5);
    expect(patterns[0]!.metricGain).toBeGreaterThan(0);
  });

  it("BUG-0052: maximize direction does NOT flip sign (negative gain if metric decreased)", () => {
    const records: ExperimentRecord[] = [
      makeRecord({ id: "1", metricBefore: 100, metricAfter: 70, success: true, direction: "maximize" }),
      makeRecord({ id: "2", metricBefore: 90, metricAfter: 60, success: true, direction: "maximize" }),
    ];

    const patterns = identifyPatterns(records, "latency");

    expect(patterns).toHaveLength(1);
    // maximize: gain = metricAfter - metricBefore = -30 (metric got worse for maximize)
    expect(patterns[0]!.metricGain).toBe(-30);
    expect(patterns[0]!.metricGain).toBeLessThan(0);
  });

  it("BUG-0052: mixed directions in same group compute gain per record direction", () => {
    const records: ExperimentRecord[] = [
      makeRecord({ id: "1", metricBefore: 100, metricAfter: 80, success: true, direction: "minimize" }),
      makeRecord({ id: "2", metricBefore: 50, metricAfter: 70, success: true, direction: "maximize" }),
    ];

    const patterns = identifyPatterns(records, "latency");

    expect(patterns).toHaveLength(1);
    // minimize gain: 100 - 80 = 20; maximize gain: 70 - 50 = 20; avg = 20
    expect(patterns[0]!.metricGain).toBe(20);
  });
});
