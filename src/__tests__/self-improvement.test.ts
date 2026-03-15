import { describe, it, expect, vi } from "vitest";
import { ExperimentLog } from "../swarm/self-improvement/experiment-log.js";
import { identifyPatterns, suggestNext } from "../swarm/self-improvement/pattern-learner.js";
import { parseManifest } from "../swarm/self-improvement/manifest.js";
import { ExperimentalExecutor } from "../harness/loop/experimental-executor.js";
import { SkillEvolver } from "../swarm/self-improvement/skill-evolver.js";

describe("ExperimentLog", () => {
  it("logs and retrieves records", () => {
    const log = new ExperimentLog();
    log.log({
      agentId: "agent-1",
      hypothesis: "use caching",
      targetMetric: "latency",
      expectedDelta: 0.1,
      metricBefore: 1.0,
      metricAfter: 0.8,
      success: true,
      contextSummary: "Cache hit test",
    });
    const history = log.getHistory("agent-1");
    expect(history).toHaveLength(1);
    expect(history[0]!.hypothesis).toBe("use caching");
    expect(history[0]!.id).toBeDefined();
    expect(history[0]!.timestamp).toBeDefined();
  });

  it("getSuccessfulPatterns filters correctly", () => {
    const log = new ExperimentLog();
    log.log({ agentId: "a", hypothesis: "try x", targetMetric: "accuracy", expectedDelta: 0.05, metricBefore: 0.7, metricAfter: 0.75, success: true, contextSummary: "test" });
    log.log({ agentId: "a", hypothesis: "try y", targetMetric: "latency", expectedDelta: 0.1, metricBefore: 1.0, metricAfter: 0.95, success: false, contextSummary: "test" });
    expect(log.getSuccessfulPatterns("a", "accuracy")).toHaveLength(1);
    expect(log.getSuccessfulPatterns("a", "latency")).toHaveLength(0);
  });

  it("summarize produces readable output", () => {
    const log = new ExperimentLog();
    log.log({ agentId: "a", hypothesis: "hypothesis text", targetMetric: "latency", expectedDelta: 0.1, metricBefore: 1.0, metricAfter: 0.9, success: true, contextSummary: "ctx" });
    const summary = log.summarize("a");
    expect(summary).toContain("ExperimentLog");
    expect(summary).toContain("100%");
  });
});

describe("PatternLearner", () => {
  const makeRecord = (hypothesis: string, success: boolean, metricBefore: number, metricAfter: number): import("../swarm/self-improvement/experiment-log.js").ExperimentRecord => ({
    id: crypto.randomUUID(),
    agentId: "a",
    hypothesis,
    targetMetric: "latency",
    expectedDelta: 0.1,
    metricBefore,
    metricAfter,
    success,
    contextSummary: "ctx",
    timestamp: new Date().toISOString(),
  });

  it("identifyPatterns groups by hypothesis prefix", () => {
    const history = [
      makeRecord("cache database queries always", true, 1.0, 0.8),
      makeRecord("cache database queries sometimes", true, 0.8, 0.7),
      makeRecord("retry failed requests immediately", false, 1.0, 1.1),
      makeRecord("retry failed requests always", false, 1.0, 1.05),
    ];
    const patterns = identifyPatterns(history, "latency");
    expect(patterns.length).toBeGreaterThan(0);
    const cachePattern = patterns.find(p => p.description.includes("cache database"));
    expect(cachePattern?.successRate).toBe(1.0);
  });

  it("suggestNext recommends top patterns", () => {
    const patterns = [
      { description: "cache queries", successRate: 0.9, sampleSize: 5, metricGain: 0.2 },
      { description: "retry requests", successRate: 0.3, sampleSize: 3, metricGain: -0.05 },
    ];
    const suggestions = suggestNext({ agentId: "a", currentMetrics: {}, taskDescription: "test" }, patterns);
    expect(suggestions[0]).toContain("cache queries");
  });
});

describe("parseManifest", () => {
  it("parses constraints from YAML frontmatter", () => {
    const content = `---
goals:
  - metric: latency, target: 0.5, direction: minimize
constraints:
  - "never skip safety checks"
explorationBudget: 0.15
---

# Objective Manifest
`;
    const manifest = parseManifest(content);
    expect(manifest.explorationBudget).toBe(0.15);
    expect(manifest.constraints).toContain("never skip safety checks");
  });

  it("returns defaults for empty content", () => {
    const manifest = parseManifest("");
    expect(manifest.goals).toEqual([]);
    expect(manifest.explorationBudget).toBe(0.1);
  });
});

describe("ExperimentalExecutor", () => {
  it("keeps changes when metric improves", async () => {
    const executor = new ExperimentalExecutor();
    const mockCheckpointer = {
      get: vi.fn().mockResolvedValue({ threadId: "t1", step: 0, state: {}, nextNodes: [], pendingSends: [], timestamp: Date.now() }),
      put: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    let metricValue = 1.0;
    const result = await executor.runExperiment({
      checkpointer: mockCheckpointer as any,
      threadId: "t1",
      hypothesis: "improve caching",
      applyChanges: async () => { metricValue = 0.7; },
      measureMetric: async () => metricValue,
      timeBudget: 5000,
      threshold: 0.1,
    });

    expect(result.success).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(result.metricAfter).toBe(0.7);
    expect(mockCheckpointer.put).not.toHaveBeenCalled(); // no rollback needed
  });

  it("rolls back when metric does not improve", async () => {
    const executor = new ExperimentalExecutor();
    const snapshot = { threadId: "t1", step: 0, state: {}, nextNodes: [], pendingSends: [], timestamp: Date.now() };
    const mockCheckpointer = {
      get: vi.fn().mockResolvedValue(snapshot),
      put: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    let metricValue = 1.0;
    const result = await executor.runExperiment({
      checkpointer: mockCheckpointer as any,
      threadId: "t1",
      hypothesis: "bad change",
      applyChanges: async () => { metricValue = 1.05; }, // worse
      measureMetric: async () => metricValue,
      timeBudget: 5000,
      threshold: 0.1,
    });

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(mockCheckpointer.put).toHaveBeenCalledWith(snapshot); // rollback happened
  });
});

describe("SkillEvolver", () => {
  it("identifies weak skills", () => {
    const evolver = new SkillEvolver({ minSamples: 2, weaknessThreshold: 0.7 });
    evolver.recordSkillUsage("code_review", "failure", "context 1");
    evolver.recordSkillUsage("code_review", "failure", "context 2");
    evolver.recordSkillUsage("code_review", "failure", "context 3");
    evolver.recordSkillUsage("code_review", "success", "context 4");
    evolver.recordSkillUsage("code_review", "failure", "context 5");

    const weak = evolver.identifyWeakSkills();
    expect(weak).toHaveLength(1);
    expect(weak[0]!.skillName).toBe("code_review");
    expect(weak[0]!.successRate).toBeLessThan(0.7);
  });
});
