import { describe, it, expect } from "vitest";
import { SwarmTracer } from "../../swarm/tracer.js";
import type { SwarmEvent } from "../../swarm/tracer.js";

/**
 * Regression test for BUG-0393: SwarmTracer.record() performs a non-atomic
 * push+splice on this.events. Concurrent callers can both observe
 * events.length > maxEvents after their respective pushes and both splice,
 * over-trimming and losing more events than intended.
 *
 * BUG-0394 is also covered here: clear() replaces this.events with a new
 * array non-atomically — a concurrent record() call holding a reference to
 * the old array writes to the discarded array, losing the event.
 *
 * These tests guard against regression by verifying exact trimming semantics
 * under sequential (single-threaded) usage.
 */

function makeEvent(agentId: string, i: number): SwarmEvent {
  return {
    type:      "agent_complete",
    agentId,
    timestamp: 1000 + i,
    data:      { index: i },
  };
}

describe("BUG-0393: SwarmTracer.record() cap enforcement (no over-trim)", () => {
  it("records up to maxEvents without trimming", () => {
    const maxEvents = 50;
    const tracer = new SwarmTracer(maxEvents);
    for (let i = 0; i < maxEvents; i++) {
      tracer.record(makeEvent("agent-a", i));
    }
    expect(tracer.getTimeline().length).toBe(maxEvents);
  });

  it("trims to maxEvents when one event over the cap is recorded", () => {
    const maxEvents = 50;
    const tracer = new SwarmTracer(maxEvents);
    for (let i = 0; i < maxEvents + 1; i++) {
      tracer.record(makeEvent("agent-a", i));
    }
    const timeline = tracer.getTimeline();
    // Exactly maxEvents — not fewer (no over-trim)
    expect(timeline.length).toBe(maxEvents);
    // Oldest event (i=0) was evicted; next oldest (i=1) is now first
    expect((timeline[0].data as Record<string, number>).index).toBe(1);
    // Newest event is still present
    expect((timeline[timeline.length - 1].data as Record<string, number>).index).toBe(maxEvents);
  });

  it("after N events above cap, timeline length is exactly maxEvents (no over-trim)", () => {
    const maxEvents = 100;
    const tracer = new SwarmTracer(maxEvents);
    for (let i = 0; i < maxEvents + 30; i++) {
      tracer.record(makeEvent("agent-b", i));
    }
    const timeline = tracer.getTimeline();
    expect(timeline.length).toBe(maxEvents);
    // Most recent maxEvents preserved; oldest 30 evicted
    expect((timeline[0].data as Record<string, number>).index).toBe(30);
    expect((timeline[timeline.length - 1].data as Record<string, number>).index).toBe(maxEvents + 29);
  });

  it("getAgentEvents() returns only matching agent events after trimming", () => {
    const maxEvents = 10;
    const tracer = new SwarmTracer(maxEvents);
    // Alternate between two agents
    for (let i = 0; i < maxEvents + 4; i++) {
      tracer.record(makeEvent(i % 2 === 0 ? "agent-x" : "agent-y", i));
    }
    const xEvents = tracer.getAgentEvents("agent-x");
    const yEvents = tracer.getAgentEvents("agent-y");
    expect(xEvents.every(e => e.agentId === "agent-x")).toBe(true);
    expect(yEvents.every(e => e.agentId === "agent-y")).toBe(true);
    // Total must equal maxEvents
    expect(xEvents.length + yEvents.length).toBe(maxEvents);
  });
});

describe("BUG-0394: SwarmTracer.clear() followed by record() works correctly", () => {
  it("clear() resets timeline to empty", () => {
    const tracer = new SwarmTracer(50);
    for (let i = 0; i < 20; i++) {
      tracer.record(makeEvent("agent-a", i));
    }
    tracer.clear();
    expect(tracer.getTimeline().length).toBe(0);
  });

  it("record() after clear() adds to fresh timeline", () => {
    const tracer = new SwarmTracer(50);
    for (let i = 0; i < 20; i++) {
      tracer.record(makeEvent("agent-a", i));
    }
    tracer.clear();
    tracer.record(makeEvent("agent-b", 999));
    const timeline = tracer.getTimeline();
    expect(timeline.length).toBe(1);
    expect(timeline[0].agentId).toBe("agent-b");
    expect((timeline[0].data as Record<string, number>).index).toBe(999);
  });

  it("multiple clear-then-record cycles maintain correct count", () => {
    const tracer = new SwarmTracer(10);
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 15; i++) {
        tracer.record(makeEvent(`agent-${cycle}`, i));
      }
      const before = tracer.getTimeline();
      expect(before.length).toBe(10);
      tracer.clear();
      expect(tracer.getTimeline().length).toBe(0);
    }
  });
});
