import { describe, it, expect } from "vitest";
import { SwarmTracer } from "../../swarm/tracer.js";

describe("SwarmTracer.metrics()", () => {
  it("computes duration, agent counts, and per-agent latency", () => {
    const tracer = new SwarmTracer();

    // Simulate: agent-a starts at T=100, completes at T=150
    //           agent-b starts at T=110, completes at T=200
    tracer.record({ type: "agent_start",    agentId: "a", timestamp: 100 });
    tracer.record({ type: "agent_start",    agentId: "b", timestamp: 110 });
    tracer.record({ type: "agent_complete", agentId: "a", timestamp: 150 });
    tracer.record({ type: "agent_complete", agentId: "b", timestamp: 200 });

    const m = tracer.metrics();

    // Total duration: last event (200) - first event (100) = 100
    expect(m.totalDurationMs).toBe(100);

    // Agent counts
    expect(m.agentCount.started).toBe(2);
    expect(m.agentCount.completed).toBe(2);
    expect(m.agentCount.errored).toBe(0);

    // Per-agent latency
    expect(m.agentLatency).toEqual({
      a: 50,  // 150 - 100
      b: 90,  // 200 - 110
    });

    // Averages
    expect(m.avgLatencyMs).toBe(70); // (50 + 90) / 2
    expect(m.maxLatencyMs).toBe(90);
  });

  it("handles errors in metrics correctly", () => {
    const tracer = new SwarmTracer();

    tracer.record({ type: "agent_start",    agentId: "ok",   timestamp: 0 });
    tracer.record({ type: "agent_start",    agentId: "fail", timestamp: 10 });
    tracer.record({ type: "agent_complete", agentId: "ok",   timestamp: 30 });
    tracer.record({ type: "agent_error",    agentId: "fail", timestamp: 50 });

    const m = tracer.metrics();

    expect(m.agentCount.started).toBe(2);
    expect(m.agentCount.completed).toBe(1);
    expect(m.agentCount.errored).toBe(1);

    // Latency for errored agents is still computed (start→error)
    expect(m.agentLatency).toEqual({
      ok:   30,
      fail: 40,
    });
  });

  it("returns zero metrics for empty timeline", () => {
    const tracer = new SwarmTracer();
    const m = tracer.metrics();

    expect(m.totalDurationMs).toBe(0);
    expect(m.agentCount.started).toBe(0);
    expect(m.agentCount.completed).toBe(0);
    expect(m.agentCount.errored).toBe(0);
    expect(m.agentLatency).toEqual({});
    expect(m.avgLatencyMs).toBe(0);
    expect(m.maxLatencyMs).toBe(0);
  });
});
