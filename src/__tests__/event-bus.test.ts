import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../events/bus.js";
import type { LifecycleEvent, AgentStartEvent, AgentEndEvent } from "../events/types.js";

describe("EventBus", () => {
  it("emits events to typed handlers", () => {
    const bus = new EventBus();
    const received: AgentStartEvent[] = [];

    bus.on("agent.start", (e) => received.push(e));

    const event: AgentStartEvent = {
      type: "agent.start",
      agent: "worker",
      timestamp: Date.now(),
      step: 0,
    };
    bus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0].agent).toBe("worker");
  });

  it("does not call handler for wrong event type", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("agent.end", handler);

    bus.emit({
      type: "agent.start",
      agent: "worker",
      timestamp: Date.now(),
      step: 0,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts listeners in constructor", () => {
    const received: string[] = [];

    const bus = new EventBus({
      "agent.start": (e) => received.push(`start:${e.agent}`),
      "agent.end": (e) => received.push(`end:${e.agent}`),
    });

    bus.emit({
      type: "agent.start",
      agent: "a",
      timestamp: Date.now(),
      step: 0,
    });
    bus.emit({
      type: "agent.end",
      agent: "a",
      timestamp: Date.now(),
      step: 0,
      duration: 100,
    });

    expect(received).toEqual(["start:a", "end:a"]);
  });

  it("onAll receives every event", () => {
    const bus = new EventBus();
    const all: LifecycleEvent[] = [];

    bus.onAll((e) => all.push(e));

    bus.emit({
      type: "agent.start",
      agent: "a",
      timestamp: Date.now(),
      step: 0,
    });
    bus.emit({
      type: "error",
      error: new Error("boom"),
      timestamp: Date.now(),
    });

    expect(all).toHaveLength(2);
    expect(all[0].type).toBe("agent.start");
    expect(all[1].type).toBe("error");
  });

  it("unsubscribe stops handler", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsub = bus.on("agent.start", handler);
    bus.emit({
      type: "agent.start",
      agent: "a",
      timestamp: Date.now(),
      step: 0,
    });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit({
      type: "agent.start",
      agent: "b",
      timestamp: Date.now(),
      step: 0,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("swallows listener errors without breaking other handlers", () => {
    const bus = new EventBus();
    const results: string[] = [];

    bus.on("agent.start", () => {
      throw new Error("handler error");
    });
    bus.on("agent.start", (e) => results.push(e.agent));

    // Also test onAll swallows errors
    bus.onAll(() => {
      throw new Error("onAll error");
    });
    bus.onAll((e) => results.push(`all:${(e as AgentStartEvent).agent}`));

    bus.emit({
      type: "agent.start",
      agent: "worker",
      timestamp: Date.now(),
      step: 0,
    });

    expect(results).toEqual(["worker", "all:worker"]);
  });
});
