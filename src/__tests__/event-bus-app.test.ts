// ============================================================
// Tests for application-level event bus extensions
// once(), dispose(), waitFor(), app events, SwarmTracer bridge
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../events/bus.js";
import type {
  SessionCreatedEvent,
  SessionCompactedEvent,
  SessionCompletedEvent,
  PermissionAskedEvent,
  PermissionRepliedEvent,
  SwarmStartedEvent,
  SwarmAgentStartedEvent,
  SwarmAgentCompletedEvent,
  SwarmAgentFailedEvent,
  SwarmCompletedEvent,
  InferenceRetryEvent,
} from "../events/types.js";
import { SwarmTracer } from "../swarm/tracer.js";
import { bridgeSwarmTracer } from "../events/bridge.js";

// ── once() ──────────────────────────────────────────────────────

describe("EventBus.once()", () => {
  it("fires handler exactly once then auto-unsubscribes", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once("session.created", handler);

    const event: SessionCreatedEvent = {
      type: "session.created",
      sessionId: "s1",
      agentName: "build",
      timestamp: Date.now(),
    };

    bus.emit(event);
    bus.emit(event);
    bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("returns unsubscribe function that cancels before first fire", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsub = bus.once("session.created", handler);
    unsub(); // cancel before event fires

    bus.emit({
      type: "session.created",
      sessionId: "s1",
      agentName: "build",
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ── dispose() ───────────────────────────────────────────────────

describe("EventBus.dispose()", () => {
  it("removes all handlers and prevents further subscriptions", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("session.created", handler);
    bus.dispose();

    bus.emit({
      type: "session.created",
      sessionId: "s1",
      agentName: "build",
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("clears onAll handlers too", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.onAll(handler);
    bus.dispose();

    bus.emit({
      type: "session.completed",
      sessionId: "s1",
      turns: 5,
      reason: "completed",
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ── waitFor() ───────────────────────────────────────────────────

describe("EventBus.waitFor()", () => {
  it("returns a promise that resolves on next event of that type", async () => {
    const bus = new EventBus();

    const promise = bus.waitFor("permission.replied");

    // Emit after a tick
    setTimeout(() => {
      bus.emit({
        type: "permission.replied",
        toolName: "bash",
        decision: "allow",
        timestamp: Date.now(),
      });
    }, 5);

    const event = await promise;
    expect(event.type).toBe("permission.replied");
    expect((event as PermissionRepliedEvent).decision).toBe("allow");
  });

  it("resolves with timeout (rejects if no event within deadline)", async () => {
    const bus = new EventBus();

    await expect(
      bus.waitFor("permission.replied", 50),
    ).rejects.toThrow("timed out");
  });

  it("auto-unsubscribes after resolving", async () => {
    const bus = new EventBus();
    const allHandler = vi.fn();
    bus.onAll(allHandler);

    const promise = bus.waitFor("session.created");

    bus.emit({
      type: "session.created",
      sessionId: "s1",
      agentName: "build",
      timestamp: Date.now(),
    });

    await promise;

    // Emit again — waitFor should not interfere
    bus.emit({
      type: "session.created",
      sessionId: "s2",
      agentName: "build",
      timestamp: Date.now(),
    });

    // onAll still works (2 events)
    expect(allHandler).toHaveBeenCalledTimes(2);
  });
});

// ── Application Event Types ─────────────────────────────────────

describe("application event types", () => {
  it("emits session.created", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("session.created", handler);

    bus.emit({
      type: "session.created",
      sessionId: "s1",
      agentName: "build",
      timestamp: Date.now(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].sessionId).toBe("s1");
  });

  it("emits session.compacted", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("session.compacted", handler);

    const event: SessionCompactedEvent = {
      type: "session.compacted",
      sessionId: "s1",
      beforeCount: 50,
      afterCount: 5,
      summarized: true,
      timestamp: Date.now(),
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("emits permission.asked and permission.replied", () => {
    const bus = new EventBus();
    const asked = vi.fn();
    const replied = vi.fn();
    bus.on("permission.asked", asked);
    bus.on("permission.replied", replied);

    bus.emit({
      type: "permission.asked",
      toolName: "bash",
      input: { command: "rm -rf /" },
      timestamp: Date.now(),
    });

    bus.emit({
      type: "permission.replied",
      toolName: "bash",
      decision: "deny",
      timestamp: Date.now(),
    });

    expect(asked).toHaveBeenCalledTimes(1);
    expect(replied).toHaveBeenCalledTimes(1);
    expect(replied.mock.calls[0][0].decision).toBe("deny");
  });

  it("emits inference.retry", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("inference.retry", handler);

    const event: InferenceRetryEvent = {
      type: "inference.retry",
      attempt: 2,
      maxRetries: 3,
      delayMs: 4000,
      error: "rate limit",
      timestamp: Date.now(),
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("emits swarm lifecycle events", () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.onAll((e) => events.push(e.type));

    bus.emit({
      type: "swarm.started",
      swarmId: "sw1",
      topology: "fanOut",
      agentCount: 3,
      timestamp: Date.now(),
    } satisfies SwarmStartedEvent);

    bus.emit({
      type: "swarm.agent.started",
      swarmId: "sw1",
      agentName: "worker-1",
      timestamp: Date.now(),
    } satisfies SwarmAgentStartedEvent);

    bus.emit({
      type: "swarm.agent.completed",
      swarmId: "sw1",
      agentName: "worker-1",
      durationMs: 500,
      timestamp: Date.now(),
    } satisfies SwarmAgentCompletedEvent);

    bus.emit({
      type: "swarm.agent.failed",
      swarmId: "sw1",
      agentName: "worker-2",
      error: "timeout",
      timestamp: Date.now(),
    } satisfies SwarmAgentFailedEvent);

    bus.emit({
      type: "swarm.completed",
      swarmId: "sw1",
      durationMs: 1200,
      agentResults: { "worker-1": "done" },
      timestamp: Date.now(),
    } satisfies SwarmCompletedEvent);

    expect(events).toEqual([
      "swarm.started",
      "swarm.agent.started",
      "swarm.agent.completed",
      "swarm.agent.failed",
      "swarm.completed",
    ]);
  });
});

// ── SwarmTracer Bridge ──────────────────────────────────────────

describe("bridgeSwarmTracer", () => {
  it("republishes agent_start as swarm.agent.started", () => {
    const bus = new EventBus();
    const tracer = new SwarmTracer();
    const handler = vi.fn();

    bus.on("swarm.agent.started", handler);
    const unsub = bridgeSwarmTracer(tracer, bus, "sw1");

    tracer.record({
      type: "agent_start",
      agentId: "worker-1",
      timestamp: Date.now(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].agentName).toBe("worker-1");
    expect(handler.mock.calls[0][0].swarmId).toBe("sw1");

    unsub();
  });

  it("republishes agent_complete as swarm.agent.completed", () => {
    const bus = new EventBus();
    const tracer = new SwarmTracer();
    const handler = vi.fn();

    bus.on("swarm.agent.completed", handler);
    bridgeSwarmTracer(tracer, bus, "sw1");

    tracer.record({
      type: "agent_start",
      agentId: "worker-1",
      timestamp: Date.now() - 500,
    });
    tracer.record({
      type: "agent_complete",
      agentId: "worker-1",
      timestamp: Date.now(),
      data: { result: "done" },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].agentName).toBe("worker-1");
    expect(handler.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("republishes agent_error as swarm.agent.failed", () => {
    const bus = new EventBus();
    const tracer = new SwarmTracer();
    const handler = vi.fn();

    bus.on("swarm.agent.failed", handler);
    bridgeSwarmTracer(tracer, bus, "sw1");

    tracer.record({
      type: "agent_error",
      agentId: "worker-1",
      timestamp: Date.now(),
      data: new Error("boom"),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].error).toBe("boom");
  });

  it("unsubscribe stops bridge", () => {
    const bus = new EventBus();
    const tracer = new SwarmTracer();
    const handler = vi.fn();

    bus.on("swarm.agent.started", handler);
    const unsub = bridgeSwarmTracer(tracer, bus, "sw1");

    unsub();

    tracer.record({
      type: "agent_start",
      agentId: "worker-1",
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ── handlerCount() ──────────────────────────────────────────────

describe("EventBus.handlerCount()", () => {
  it("returns count of handlers for a specific event type", () => {
    const bus = new EventBus();
    expect(bus.handlerCount("session.created")).toBe(0);

    const unsub1 = bus.on("session.created", () => {});
    const unsub2 = bus.on("session.created", () => {});
    bus.on("session.completed", () => {});

    expect(bus.handlerCount("session.created")).toBe(2);
    expect(bus.handlerCount("session.completed")).toBe(1);

    unsub1();
    expect(bus.handlerCount("session.created")).toBe(1);
  });
});
