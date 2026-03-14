import { describe, it, expect } from "vitest";
import { SwarmTracer, type SwarmEvent } from "../../swarm/tracer.js";

describe("SwarmTracer live event subscription", () => {
  it("subscriber receives events as they are recorded", () => {
    const tracer = new SwarmTracer();
    const events: SwarmEvent[] = [];
    tracer.subscribe((e) => events.push(e));

    tracer.record({ type: "agent_start", agentId: "a", timestamp: 1 });
    tracer.record({ type: "agent_complete", agentId: "a", timestamp: 2, data: "ok" });

    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("agent_start");
    expect(events[1]!.type).toBe("agent_complete");
  });

  it("multiple subscribers all receive the same events", () => {
    const tracer = new SwarmTracer();
    const eventsA: SwarmEvent[] = [];
    const eventsB: SwarmEvent[] = [];
    tracer.subscribe((e) => eventsA.push(e));
    tracer.subscribe((e) => eventsB.push(e));

    tracer.record({ type: "agent_start", agentId: "x", timestamp: 1 });

    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(1);
    expect(eventsA[0]!.agentId).toBe("x");
    expect(eventsB[0]!.agentId).toBe("x");
  });

  it("unsubscribe stops receiving events", () => {
    const tracer = new SwarmTracer();
    const events: SwarmEvent[] = [];
    const listener = (e: SwarmEvent) => events.push(e);

    tracer.subscribe(listener);
    tracer.record({ type: "agent_start", agentId: "a", timestamp: 1 });
    expect(events).toHaveLength(1);

    tracer.unsubscribe(listener);
    tracer.record({ type: "agent_complete", agentId: "a", timestamp: 2 });
    expect(events).toHaveLength(1); // no new event
  });

  it("subscriber errors do not prevent other subscribers or recording", () => {
    const tracer = new SwarmTracer();
    const events: SwarmEvent[] = [];

    // Bad subscriber throws
    tracer.subscribe(() => { throw new Error("subscriber crash"); });
    // Good subscriber still works
    tracer.subscribe((e) => events.push(e));

    tracer.record({ type: "agent_start", agentId: "a", timestamp: 1 });

    // Event was still recorded in timeline
    expect(tracer.getTimeline()).toHaveLength(1);
    // Good subscriber still received it
    expect(events).toHaveLength(1);
  });

  it("subscribe returns an unsubscribe function for convenience", () => {
    const tracer = new SwarmTracer();
    const events: SwarmEvent[] = [];

    const unsub = tracer.subscribe((e) => events.push(e));
    tracer.record({ type: "agent_start", agentId: "a", timestamp: 1 });
    expect(events).toHaveLength(1);

    unsub();
    tracer.record({ type: "agent_complete", agentId: "a", timestamp: 2 });
    expect(events).toHaveLength(1); // unsubscribed
  });

  it("clear does not remove subscribers — they keep receiving new events", () => {
    const tracer = new SwarmTracer();
    const events: SwarmEvent[] = [];
    tracer.subscribe((e) => events.push(e));

    tracer.record({ type: "agent_start", agentId: "a", timestamp: 1 });
    tracer.clear();
    tracer.record({ type: "agent_start", agentId: "b", timestamp: 2 });

    // Timeline was cleared but subscriber still active
    expect(tracer.getTimeline()).toHaveLength(1); // only "b"
    expect(events).toHaveLength(2); // got both "a" and "b"
  });
});
