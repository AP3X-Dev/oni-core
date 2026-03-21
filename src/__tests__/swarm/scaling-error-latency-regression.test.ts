/**
 * Regression test for BUG-0299:
 *   recentMaxLatencyMs computation only processed agent_complete events, not
 *   agent_error events. Erroring agents with high latency never contributed to
 *   latency-based scale-up decisions.
 *
 * Fix: line 192 of src/swarm/scaling.ts now includes agent_error alongside
 * agent_complete in the latency accumulation branch.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SwarmTracer } from "../../swarm/tracer.js";
import {
  DynamicScalingMonitor,
  type ScalingConfig,
} from "../../swarm/scaling.js";

describe("BUG-0299 regression: erroring agents contribute to latency-based scale-up", () => {
  let tracer: SwarmTracer;

  beforeEach(() => {
    tracer = new SwarmTracer();
  });

  it("triggers latency scale-up when only agent_error events end a slow run", () => {
    // Use a low error-rate threshold so the error-rate path doesn't mask the latency path.
    // With 2 agents (1 error, 1 complete) the error rate is 50% — set threshold to 0.8 so
    // error-rate does NOT fire. Only the latency path can produce scale_up here.
    const config: ScalingConfig = {
      minAgents: 1,
      maxAgents: 10,
      scaleUpErrorRate: 0.8, // 50% error rate will NOT reach this threshold
      scaleUpLatencyMs: 1000,
      scaleDownIdleSeconds: 60,
      cooldownMs: 0,
    };
    const monitor = new DynamicScalingMonitor(tracer, config);
    monitor.setCurrentAgentCount(2);

    const now = Date.now();
    // One fast successful agent (below latency threshold).
    tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 5000 });
    tracer.record({ type: "agent_complete", agentId: "a1", timestamp: now - 4800 }); // 200ms
    // One slow erroring agent — latency = 3000ms, well above the 1000ms threshold.
    tracer.record({ type: "agent_start", agentId: "slow-err", timestamp: now - 4000 });
    tracer.record({ type: "agent_error", agentId: "slow-err", timestamp: now - 1000 }); // 3000ms

    const decision = monitor.evaluate();
    expect(decision.action).toBe("scale_up");
    expect(decision.reason).toContain("latency");
  });

  it("does not trigger latency scale-up when error latency is below threshold", () => {
    const config: ScalingConfig = {
      minAgents: 1,
      maxAgents: 10,
      scaleUpErrorRate: 0.8, // same guard: 50% error rate won't fire this
      scaleUpLatencyMs: 5000,
      scaleDownIdleSeconds: 60,
      cooldownMs: 0,
    };
    const monitor = new DynamicScalingMonitor(tracer, config);
    monitor.setCurrentAgentCount(2);

    const now = Date.now();
    // One fast successful agent.
    tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 5000 });
    tracer.record({ type: "agent_complete", agentId: "a1", timestamp: now - 4800 }); // 200ms
    // One fast erroring agent (500ms) — below 5000ms threshold.
    tracer.record({ type: "agent_start", agentId: "fast-err", timestamp: now - 4000 });
    tracer.record({ type: "agent_error", agentId: "fast-err", timestamp: now - 3500 }); // 500ms

    const decision = monitor.evaluate();
    // Latency path should NOT fire — action must not be a latency-driven scale_up.
    if (decision.action === "scale_up") {
      expect(decision.reason).not.toContain("latency");
    }
  });
});
