import { describe, it, expect, vi } from "vitest";
import { PubSub } from "../coordination/pubsub.js";

// BUG-0312 regression: PubSub.publish() iterated this.subscribers and each
// handler Set directly. New subscriptions added mid-iteration (by a handler)
// could be visited in the same publish() call, causing non-deterministic
// event delivery. Fix: snapshot both Maps and Sets before iterating.

describe("PubSub publish() snapshot isolation (BUG-0312)", () => {
  it("a subscriber added during delivery does not receive the triggering event", () => {
    const ps = new PubSub();
    const lateHandler = vi.fn();

    // Handler A subscribes a second handler (lateHandler) when it fires.
    // Without the snapshot fix, lateHandler would be added to the same Set
    // currently being iterated, and ECMAScript guarantees newly added entries
    // will be visited — so lateHandler would receive the current event.
    const handlerA = vi.fn(() => {
      ps.subscribe("task.*", lateHandler);
    });

    ps.subscribe("task.*", handlerA);
    ps.publish("agent", "task.done", { ok: true });

    // handlerA must have fired
    expect(handlerA).toHaveBeenCalledOnce();

    // lateHandler was added during delivery — it must NOT have been called
    // for this event (it was not subscribed when publish() began).
    expect(lateHandler).not.toHaveBeenCalled();

    // But lateHandler SHOULD fire on the next publish
    ps.publish("agent", "task.done", { ok: true });
    expect(lateHandler).toHaveBeenCalledOnce();
  });

  it("unsubscribing during delivery does not skip remaining handlers or throw", () => {
    const ps = new PubSub();
    const callOrder: string[] = [];
    let unsubB: (() => void) | undefined;

    const handlerA = vi.fn(() => {
      callOrder.push("A");
      // A removes B mid-iteration; B should still fire because Set was snapshotted
      unsubB?.();
    });

    const handlerB = vi.fn(() => {
      callOrder.push("B");
    });

    unsubB = ps.subscribe("data.event", handlerB);
    ps.subscribe("data.event", handlerA);

    // Should not throw
    expect(() => ps.publish("src", "data.event", null)).not.toThrow();

    // Both handlers that were registered at publish-time must fire
    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();

    // Both ran (order may vary — just verify both called)
    expect(callOrder).toContain("A");
    expect(callOrder).toContain("B");

    // After unsub, B must not fire on subsequent publishes
    ps.publish("src", "data.event", null);
    expect(handlerB).toHaveBeenCalledOnce(); // still once
    expect(handlerA).toHaveBeenCalledTimes(2);
  });

  it("new pattern subscription added during delivery does not receive current event", () => {
    const ps = new PubSub();
    const lateHandler = vi.fn();

    // Handler subscribes a brand-new PATTERN during delivery
    const handlerA = vi.fn(() => {
      ps.subscribe("agent.*", lateHandler); // new pattern key in the subscribers Map
    });

    ps.subscribe("agent.*", handlerA);
    ps.publish("sys", "agent.start", {});

    // handlerA fired
    expect(handlerA).toHaveBeenCalledOnce();

    // lateHandler was added to subscribers Map mid-iteration; without snapshot
    // the new Map entry would be visited by for..of on the same Map.
    expect(lateHandler).not.toHaveBeenCalled();
  });
});
