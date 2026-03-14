import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentPool } from "../../swarm/pool.js";
import { SwarmTracer } from "../../swarm/tracer.js";
import {
  DynamicScalingMonitor,
  type ScalingDecision,
  type ScalingConfig,
} from "../../swarm/scaling.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

// ── Helpers ────────────────────────────────────────────────────

function makeDummyAgent<S extends Record<string, unknown>>(
  id: string,
  opts?: { maxConcurrency?: number },
): SwarmAgentDef<S> {
  return {
    id,
    role: `Role ${id}`,
    capabilities: [{ name: "work", description: "does work" }],
    skeleton: {
      invoke: vi.fn().mockResolvedValue({ task: "done" } as unknown as S),
    } as any,
    maxConcurrency: opts?.maxConcurrency ?? 1,
  };
}

// ── AgentPool.addSlots / removeSlots ────────────────────────

describe("AgentPool dynamic resize", () => {
  it("addSlots increases pool size", () => {
    const pool = new AgentPool([makeDummyAgent("a1")]);
    expect(pool.stats()).toHaveLength(1);

    pool.addSlots([makeDummyAgent("a2"), makeDummyAgent("a3")]);
    expect(pool.stats()).toHaveLength(3);
    expect(pool.stats().map((s) => s.agentId)).toEqual(["a1", "a2", "a3"]);
  });

  it("addSlots rejects duplicate agent IDs", () => {
    const pool = new AgentPool([makeDummyAgent("a1")]);
    expect(() => pool.addSlots([makeDummyAgent("a1")])).toThrow("duplicate");
  });

  it("addSlots with empty array is a no-op", () => {
    const pool = new AgentPool([makeDummyAgent("a1")]);
    pool.addSlots([]);
    expect(pool.stats()).toHaveLength(1);
  });

  it("removeSlots decreases pool size", () => {
    const pool = new AgentPool([
      makeDummyAgent("a1"),
      makeDummyAgent("a2"),
      makeDummyAgent("a3"),
    ]);
    pool.removeSlots(["a2"]);
    expect(pool.stats()).toHaveLength(2);
    expect(pool.stats().map((s) => s.agentId)).toEqual(["a1", "a3"]);
  });

  it("removeSlots ignores unknown IDs", () => {
    const pool = new AgentPool([makeDummyAgent("a1")]);
    pool.removeSlots(["nonexistent"]);
    expect(pool.stats()).toHaveLength(1);
  });

  it("removeSlots rejects removing last agent", () => {
    const pool = new AgentPool([makeDummyAgent("a1")]);
    expect(() => pool.removeSlots(["a1"])).toThrow("at least one");
  });

  it("new slots are available for routing immediately", async () => {
    const pool = new AgentPool([makeDummyAgent("a1")]);
    pool.addSlots([makeDummyAgent("a2")]);

    // Invoke twice in parallel — both should be routed (one to each slot)
    const [r1, r2] = await Promise.all([
      pool.invoke({ task: "t1" } as any),
      pool.invoke({ task: "t2" } as any),
    ]);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    const stats = pool.stats();
    const totalRuns = stats.reduce((acc, s) => acc + s.totalRuns, 0);
    expect(totalRuns).toBe(2);
  });

  it("slotCount returns current number of slots", () => {
    const pool = new AgentPool([makeDummyAgent("a1"), makeDummyAgent("a2")]);
    expect(pool.slotCount()).toBe(2);
    pool.addSlots([makeDummyAgent("a3")]);
    expect(pool.slotCount()).toBe(3);
    pool.removeSlots(["a2"]);
    expect(pool.slotCount()).toBe(2);
  });
});

// ── DynamicScalingMonitor ──────────────────────────────────

describe("DynamicScalingMonitor", () => {
  let tracer: SwarmTracer;
  let config: ScalingConfig;

  beforeEach(() => {
    tracer = new SwarmTracer();
    config = {
      minAgents: 1,
      maxAgents: 10,
      scaleUpErrorRate: 0.3,
      scaleUpLatencyMs: 5000,
      scaleDownIdleSeconds: 10,
      cooldownMs: 1000,
    };
  });

  it("creates with default config", () => {
    const monitor = new DynamicScalingMonitor(tracer);
    const cfg = monitor.getConfig();
    expect(cfg.minAgents).toBe(1);
    expect(cfg.maxAgents).toBe(10);
  });

  it("creates with custom config", () => {
    const customConfig: ScalingConfig = { ...config, scaleUpErrorRate: 0.4 };
    const monitor = new DynamicScalingMonitor(tracer, customConfig);
    const cfg = monitor.getConfig();
    expect(cfg.scaleUpErrorRate).toBe(0.4);
  });

  it("starts in idle state", () => {
    const monitor = new DynamicScalingMonitor(tracer, config);
    expect(monitor.getState().lastDecision).toBeNull();
    expect(monitor.getState().currentAgentCount).toBe(0);
  });

  describe("scale-up decisions", () => {
    it("recommends scale-up when error rate exceeds threshold", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleUpErrorRate: 0.3,
        cooldownMs: 0,
      });

      // Simulate: 3 starts, 2 errors, 1 complete → 67% error rate
      const now = Date.now();
      monitor.setCurrentAgentCount(3);
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 5000 });
      tracer.record({ type: "agent_start", agentId: "a2", timestamp: now - 4999 });
      tracer.record({ type: "agent_start", agentId: "a3", timestamp: now - 4998 });
      tracer.record({ type: "agent_error", agentId: "a1", timestamp: now - 4000 });
      tracer.record({ type: "agent_error", agentId: "a2", timestamp: now - 3999 });
      tracer.record({ type: "agent_complete", agentId: "a3", timestamp: now - 3998 });

      const decision = monitor.evaluate();
      expect(decision.action).toBe("scale_up");
      expect(decision.count).toBeGreaterThan(0);
      expect(decision.reason).toContain("error rate");
    });

    it("recommends scale-up when latency exceeds threshold", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleUpLatencyMs: 1000,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(2);

      const now = Date.now();
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 5000 });
      tracer.record({ type: "agent_complete", agentId: "a1", timestamp: now - 3000 }); // 2000ms > 1000ms

      const decision = monitor.evaluate();
      expect(decision.action).toBe("scale_up");
      expect(decision.reason).toContain("latency");
    });

    it("caps scale-up at maxAgents", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        maxAgents: 5,
        scaleUpErrorRate: 0.1,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(4);

      // Many errors to trigger scale-up
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        tracer.record({ type: "agent_start", agentId: `a${i}`, timestamp: now - 5000 + i * 10 });
        tracer.record({ type: "agent_error", agentId: `a${i}`, timestamp: now - 4950 + i * 10 });
      }

      const decision = monitor.evaluate();
      if (decision.action === "scale_up") {
        expect(decision.count + 4).toBeLessThanOrEqual(5);
      }
    });
  });

  describe("scale-down decisions", () => {
    it("recommends scale-down when all agents idle for scaleDownIdleSeconds", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleDownIdleSeconds: 5,
        minAgents: 1,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(4);

      // All agents completed long ago
      const now = Date.now();
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 20000 });
      tracer.record({ type: "agent_complete", agentId: "a1", timestamp: now - 15000 });
      tracer.record({ type: "agent_start", agentId: "a2", timestamp: now - 20000 });
      tracer.record({ type: "agent_complete", agentId: "a2", timestamp: now - 15000 });

      const decision = monitor.evaluate();
      expect(decision.action).toBe("scale_down");
      expect(decision.count).toBeGreaterThan(0);
    });

    it("respects minAgents", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleDownIdleSeconds: 0,
        minAgents: 2,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(2);

      const decision = monitor.evaluate();
      // At minimum — cannot scale down
      expect(decision.action).toBe("idle");
    });
  });

  describe("cooldown", () => {
    it("returns idle during cooldown period", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleUpErrorRate: 0.1,
        cooldownMs: 5000,
      });
      monitor.setCurrentAgentCount(2);

      // Trigger a scale-up
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        tracer.record({ type: "agent_start", agentId: `a${i}`, timestamp: now - 5000 + i });
        tracer.record({ type: "agent_error", agentId: `a${i}`, timestamp: now - 4000 + i });
      }

      const first = monitor.evaluate();
      expect(first.action).toBe("scale_up");

      // Apply the decision
      monitor.recordDecision(first);

      // Immediate re-evaluation should be idle (cooldown)
      const second = monitor.evaluate();
      expect(second.action).toBe("idle");
      expect(second.reason).toContain("cooldown");
    });
  });

  describe("reactive subscription", () => {
    it("fires callback on scale-up trigger via tracer events", () => {
      const decisions: ScalingDecision[] = [];
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleUpErrorRate: 0.3,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(3);

      // Subscribe to reactive scaling events
      monitor.onScaleDecision((d) => decisions.push(d));

      // Enable reactive mode — evaluate after each error event
      monitor.enableReactive();

      // Fire events that should trigger scale-up
      const now = Date.now();
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 5000 });
      tracer.record({ type: "agent_start", agentId: "a2", timestamp: now - 4999 });
      tracer.record({ type: "agent_error", agentId: "a1", timestamp: now - 4000 });
      tracer.record({ type: "agent_error", agentId: "a2", timestamp: now - 3999 });

      // Should have fired at least one scale-up decision
      const scaleUps = decisions.filter((d) => d.action === "scale_up");
      expect(scaleUps.length).toBeGreaterThanOrEqual(1);
    });

    it("disableReactive stops event-driven evaluation", () => {
      const decisions: ScalingDecision[] = [];
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleUpErrorRate: 0.1,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(2);
      monitor.onScaleDecision((d) => decisions.push(d));
      monitor.enableReactive();
      monitor.disableReactive();

      // Fire error events after disabling
      const now = Date.now();
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 5000 });
      tracer.record({ type: "agent_error", agentId: "a1", timestamp: now - 4000 });

      expect(decisions).toHaveLength(0);
    });
  });

  describe("getHistory", () => {
    it("records decisions in history", () => {
      const monitor = new DynamicScalingMonitor(tracer, config);
      const d1: ScalingDecision = { action: "scale_up", count: 2, reason: "test" };
      const d2: ScalingDecision = { action: "idle", count: 0, reason: "ok" };
      monitor.recordDecision(d1);
      monitor.recordDecision(d2);

      const history = monitor.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.decision.action).toBe("scale_up");
      expect(history[1]!.decision.action).toBe("idle");
    });
  });

  describe("edge cases", () => {
    it("handles empty tracer timeline", () => {
      const monitor = new DynamicScalingMonitor(tracer, config);
      monitor.setCurrentAgentCount(2);
      const decision = monitor.evaluate();
      expect(decision.action).toBe("idle");
    });

    it("handles zero current agents", () => {
      const monitor = new DynamicScalingMonitor(tracer, config);
      monitor.setCurrentAgentCount(0);
      const decision = monitor.evaluate();
      expect(decision.action).toBe("idle");
    });
  });

  describe("threshold boundary conditions", () => {
    // -- Error rate boundaries --
    // Default scaleUpErrorRate is 0.25 (25%). These tests use explicit
    // config to test at exactly the default boundary.

    it("does NOT scale up at 24% error rate (just below 25% threshold)", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        minAgents: 1,
        maxAgents: 10,
        scaleUpErrorRate: 0.25,
        scaleUpLatencyMs: 999999, // disable latency trigger
        scaleDownIdleSeconds: 9999,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(4);

      // 100 starts, 24 errors → 24% error rate
      const now = Date.now();
      for (let i = 0; i < 100; i++) {
        tracer.record({ type: "agent_start", agentId: `a${i % 4}`, timestamp: now - 50000 + i * 10 });
      }
      for (let i = 0; i < 24; i++) {
        tracer.record({ type: "agent_error", agentId: `a${i % 4}`, timestamp: now - 49000 + i * 10 });
      }

      const decision = monitor.evaluate();
      expect(decision.action).not.toBe("scale_up");
    });

    it("DOES scale up at 25% error rate (at threshold)", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        minAgents: 1,
        maxAgents: 10,
        scaleUpErrorRate: 0.25,
        scaleUpLatencyMs: 999999,
        scaleDownIdleSeconds: 9999,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(4);

      // 100 starts, 25 errors → 25% error rate
      const now = Date.now();
      for (let i = 0; i < 100; i++) {
        tracer.record({ type: "agent_start", agentId: `a${i % 4}`, timestamp: now - 50000 + i * 10 });
      }
      for (let i = 0; i < 25; i++) {
        tracer.record({ type: "agent_error", agentId: `a${i % 4}`, timestamp: now - 49000 + i * 10 });
      }

      const decision = monitor.evaluate();
      expect(decision.action).toBe("scale_up");
      expect(decision.reason).toContain("error rate");
    });

    // -- Latency boundaries --
    // Default scaleUpLatencyMs is 15000 (15s). Multi-turn LLM agents
    // typically take 15-120s per lifecycle. The threshold must not
    // false-trigger on normal Opus agent latency (~10s).

    it("does NOT scale up at 14s max latency (below 15s threshold)", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        minAgents: 1,
        maxAgents: 10,
        scaleUpErrorRate: 1.0, // disable error trigger
        scaleUpLatencyMs: 15000,
        scaleDownIdleSeconds: 9999,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(3);

      const now = Date.now();
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 18000 });
      tracer.record({ type: "agent_complete", agentId: "a1", timestamp: now - 4000 }); // 14s

      const decision = monitor.evaluate();
      expect(decision.action).not.toBe("scale_up");
    });

    it("DOES scale up at 16s max latency (above 15s threshold)", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        minAgents: 1,
        maxAgents: 10,
        scaleUpErrorRate: 1.0,
        scaleUpLatencyMs: 15000,
        scaleDownIdleSeconds: 9999,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(3);

      const now = Date.now();
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 20000 });
      tracer.record({ type: "agent_complete", agentId: "a1", timestamp: now - 4000 }); // 16s

      const decision = monitor.evaluate();
      expect(decision.action).toBe("scale_up");
      expect(decision.reason).toContain("latency");
    });

    // -- Idle scale-down boundaries --
    // Default scaleDownIdleSeconds is 60. Agents may take 30-60s per
    // lifecycle. Idle threshold must not false-trigger while agents
    // are still executing.

    it("does NOT scale down at 59s idle (below 60s threshold)", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        minAgents: 1,
        maxAgents: 10,
        scaleUpErrorRate: 1.0,
        scaleUpLatencyMs: 999999,
        scaleDownIdleSeconds: 60,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(4);

      const now = Date.now();
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 59000 });

      const decision = monitor.evaluate();
      expect(decision.action).not.toBe("scale_down");
    });

    it("DOES scale down at 61s idle (above 60s threshold)", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        minAgents: 1,
        maxAgents: 10,
        scaleUpErrorRate: 1.0,
        scaleUpLatencyMs: 999999,
        scaleDownIdleSeconds: 60,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(4);

      const now = Date.now();
      tracer.record({ type: "agent_start", agentId: "a1", timestamp: now - 61000 });
      // Agent completed shortly after starting — inFlight drops to 0.
      // lastActivity is now - 61000 + 100 ≈ 60.9s ago, still over the 60s threshold.
      tracer.record({ type: "agent_complete", agentId: "a1", timestamp: now - 61000 + 100 });

      const decision = monitor.evaluate();
      expect(decision.action).toBe("scale_down");
    });

    // -- Cooldown boundary --
    // Default cooldownMs is 10000 (10s). Prevents oscillation in
    // reactive mode where multiple events fire in rapid succession.

    it("blocks decision at 9s after previous (cooldown still active)", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        minAgents: 1,
        maxAgents: 10,
        scaleUpErrorRate: 0.1,
        scaleUpLatencyMs: 999999,
        scaleDownIdleSeconds: 9999,
        cooldownMs: 10000,
      });
      monitor.setCurrentAgentCount(3);

      // Trigger initial scale-up
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        tracer.record({ type: "agent_start", agentId: `a${i}`, timestamp: now - 5000 + i });
        tracer.record({ type: "agent_error", agentId: `a${i}`, timestamp: now - 4000 + i });
      }
      const first = monitor.evaluate();
      expect(first.action).toBe("scale_up");
      monitor.recordDecision(first);

      // Immediately re-evaluate (within 10s cooldown)
      const second = monitor.evaluate();
      expect(second.action).toBe("idle");
      expect(second.reason).toContain("cooldown");
    });

    // -- Default config verification --

    it("default thresholds are tuned for LLM agent swarms", () => {
      const monitor = new DynamicScalingMonitor(tracer);
      const cfg = monitor.getConfig();

      // 25% error rate: catches problems early without over-reacting
      // to transient single-agent failures
      expect(cfg.scaleUpErrorRate).toBe(0.25);

      // 15s latency: realistic for multi-turn LLM agents
      // (Opus ~10s/inference × 2-3 turns + tool execution)
      expect(cfg.scaleUpLatencyMs).toBe(15000);

      // 60s idle: prevents false scale-down while agents are mid-execution
      // (agents typically take 30-120s per full lifecycle)
      expect(cfg.scaleDownIdleSeconds).toBe(60);

      // 10s cooldown: prevents oscillation in reactive mode
      expect(cfg.cooldownMs).toBe(10000);
    });
  });

  describe("single-pass counting optimization", () => {
    it("scale-up error rate matches reference counts with large timeline", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleUpErrorRate: 0.3,
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(5);

      // Generate a large timeline: 200 starts, 80 errors (40% error rate > 30%)
      // Use Date.now()-relative timestamps so all events fall within the rolling window.
      const now = Date.now();
      for (let i = 0; i < 200; i++) {
        tracer.record({ type: "agent_start", agentId: `a${i % 5}`, timestamp: now - 55000 + i * 100 });
      }
      for (let i = 0; i < 80; i++) {
        tracer.record({ type: "agent_error", agentId: `a${i % 5}`, timestamp: now - 35000 + i * 100 });
      }
      // Sprinkle non-matching events
      for (let i = 0; i < 50; i++) {
        tracer.record({ type: "agent_complete", agentId: `a${i % 5}`, timestamp: now - 27000 + i * 100 });
      }

      const decision = monitor.evaluate();
      expect(decision.action).toBe("scale_up");
      expect(decision.reason).toContain("error rate");
      expect(decision.reason).toContain("40%");
    });

    it("scale-down uses last event timestamp correctly", () => {
      const monitor = new DynamicScalingMonitor(tracer, {
        ...config,
        scaleDownIdleSeconds: 5,
        scaleUpErrorRate: 1.0, // disable error-rate scale-up
        scaleUpLatencyMs: 999999, // disable latency scale-up
        cooldownMs: 0,
      });
      monitor.setCurrentAgentCount(4);

      const now = Date.now();
      // Many paired start/complete events, all old
      for (let i = 0; i < 50; i++) {
        const t = now - 30000 + i * 10;
        tracer.record({ type: "agent_start", agentId: `a${i % 4}`, timestamp: t });
        tracer.record({ type: "agent_complete", agentId: `a${i % 4}`, timestamp: t + 1 });
      }
      // Last event is still > 5s ago
      tracer.record({ type: "agent_complete", agentId: "a0", timestamp: now - 10000 });

      const decision = monitor.evaluate();
      expect(decision.action).toBe("scale_down");
    });
  });
});
