import { describe, it, expect, vi } from "vitest";
import { createAgentNode } from "../../swarm/agent-node.js";
import { AgentRegistry } from "../../swarm/registry.js";
import type { SwarmAgentDef } from "../../swarm/types.js";
import type { BaseSwarmState } from "../../swarm/config.js";

// ----------------------------------------------------------------
// Regression test: BUG-3
//
// createAgentNode() retry-delay path registered an abort listener on
// config.signal but only removed it on the abort path, not when the
// setTimeout callback resolved the delay normally:
//
//   signal?.addEventListener("abort", () => {
//     clearTimeout(timer);
//     reject(signal.reason ?? new Error("aborted"));
//   }, { once: true });
//
// With a long-lived shared config.signal reused across many graph
// invocations, every retry delay that completed via timer left an
// orphaned abort listener on the signal, accumulating unboundedly.
//
// Fix: capture the listener reference and call removeEventListener
// inside the timer callback so the listener is cleaned up on both
// paths (timer fires → remove; abort fires → { once: true } auto-
// removes).
// ----------------------------------------------------------------

type S = BaseSwarmState & Record<string, unknown>;

function makeState(overrides: Partial<S> = {}): S {
  return {
    swarmMessages: [],
    agentResults: {},
    handoffHistory: [],
    supervisorRound: 0,
    currentAgent: "agent-a",
    context: {},
    ...overrides,
  } as S;
}

function makeRegistry(): AgentRegistry<S> {
  const reg = new AgentRegistry<S>();
  return reg;
}

const swarmLiveState = {
  hasSupervisor: false,
  supervisorNodeName: "__supervisor__",
  onErrorPolicy: "throw" as const,
};

describe("BUG-3 — retry-delay AbortSignal listener must be removed when timer fires normally", () => {
  it("listener count on shared signal does not grow after timer-resolved retry delays", async () => {
    vi.useFakeTimers();

    try {
      const ac = new AbortController();
      const signal = ac.signal;

      let calls = 0;
      const skeleton = {
        invoke: vi.fn(async () => {
          calls++;
          if (calls <= 2) throw new Error(`fail #${calls}`);
          return { context: {}, agentResults: {}, handoffHistory: [], swarmMessages: [], messages: [] };
        }),
      } as unknown as SwarmAgentDef<S>["skeleton"];

      const def: SwarmAgentDef<S> = {
        id: "agent-a",
        role: "worker",
        capabilities: [],
        skeleton,
        maxRetries: 2,
        retryDelayMs: 100,
      };

      const registry = makeRegistry();
      registry.register(def);

      const nodeFn = createAgentNode(def, registry, swarmLiveState);
      const state = makeState();

      // Track abort-listener add/remove calls on the shared signal
      let added = 0;
      let removed = 0;
      const origAdd = signal.addEventListener.bind(signal);
      const origRemove = signal.removeEventListener.bind(signal);

      vi.spyOn(signal, "addEventListener").mockImplementation((type, listener, opts) => {
        if (type === "abort") added++;
        origAdd(type, listener, opts);
      });
      vi.spyOn(signal, "removeEventListener").mockImplementation((type, listener, opts) => {
        if (type === "abort") removed++;
        origRemove(type, listener, opts);
      });

      const runPromise = nodeFn(state, { signal } as any);

      // Let the first retry delay fire (100ms)
      await vi.advanceTimersByTimeAsync(100);
      // Let the second retry delay fire (100ms)
      await vi.advanceTimersByTimeAsync(100);
      // Let the final success resolve
      await vi.advanceTimersByTimeAsync(10);

      await runPromise;

      // Two retries each registered one listener and should each have removed it
      expect(added).toBe(2);
      expect(removed).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("abort path still rejects the delay promise and cleans up the timer", async () => {
    vi.useFakeTimers();

    try {
      const ac = new AbortController();
      const signal = ac.signal;

      let calls = 0;
      const skeleton = {
        invoke: vi.fn(async () => {
          calls++;
          throw new Error("always fails");
        }),
      } as unknown as SwarmAgentDef<S>["skeleton"];

      const def: SwarmAgentDef<S> = {
        id: "agent-b",
        role: "worker",
        capabilities: [],
        skeleton,
        maxRetries: 3,
        retryDelayMs: 1000,
      };

      const registry = makeRegistry();
      registry.register(def);

      const nodeFn = createAgentNode(def, registry, swarmLiveState);
      const state = makeState({ currentAgent: "agent-b" });

      // Attach rejection handler immediately to avoid unhandled-rejection warning
      const runPromise = nodeFn(state, { signal } as any);
      const resultCapture = runPromise.then(
        (v) => ({ ok: true, value: v }),
        (e) => ({ ok: false, error: e }),
      );

      // First attempt fails; retry delay starts (1000ms)
      await vi.advanceTimersByTimeAsync(10);
      // Abort the signal mid-delay — should reject immediately
      ac.abort(new Error("aborted by test"));
      await vi.advanceTimersByTimeAsync(0);

      const result = await resultCapture;
      expect(result.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
