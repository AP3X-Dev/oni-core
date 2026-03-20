import { describe, it, expect } from "vitest";
import { applyUpdate } from "../../pregel/state-helpers.js";
import { lastValue } from "../../index.js";

describe("applyUpdate — Handoff passthrough (BUG-0267)", () => {
  it("BUG-0267: should store Handoff object in __pendingHandoff instead of dropping isHandoff key", () => {
    const channels = {
      task: lastValue(() => ""),
      done: lastValue(() => false),
    };

    const current = { task: "hello", done: false };

    // Simulate a Handoff object (duck-typed via isHandoff marker).
    // Before the fix, applyUpdate would iterate the Handoff's keys (isHandoff, to, opts, etc.)
    // against the channel schema, find no match, and silently drop all of them.
    const handoffUpdate = {
      isHandoff: true,
      to: "agentB",
      opts: { message: "take over" },
    } as any;

    const result = applyUpdate(channels, current, handoffUpdate);

    // After the fix, the Handoff is stored verbatim in __pendingHandoff
    expect((result as any).__pendingHandoff).toBeDefined();
    expect((result as any).__pendingHandoff.isHandoff).toBe(true);
    expect((result as any).__pendingHandoff.to).toBe("agentB");

    // Original state fields should be preserved
    expect(result.task).toBe("hello");
    expect(result.done).toBe(false);
  });
});
