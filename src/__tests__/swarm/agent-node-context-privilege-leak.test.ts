import { describe, it, expect, vi } from "vitest";
import { createAgentNode } from "../../swarm/agent-node.js";
import { AgentRegistry } from "../../swarm/registry.js";
import type { SwarmAgentDef } from "../../swarm/types.js";
import type { BaseSwarmState } from "../../swarm/config.js";

// ----------------------------------------------------------------
// Regression test: BUG-0399
//
// The normal completion path in createAgentNode() spread result.context
// without filtering __-prefixed privileged keys:
//
//   context: {
//     ...((result as any).context ?? {}),   // ← spreads ALL keys, including __
//     __consumedMsgIds: newConsumedIds,
//   }
//
// A compromised agent skeleton could return a context containing keys like
// __deadlineAbsolute, __consumedMsgIds, or any other privileged sentinel
// used by the swarm runtime, overwriting trusted state with attacker-
// controlled values.
//
// Fix: extract rawCtx from result, build safeCtx by filtering out all
// keys whose names start with "__", then spread safeCtx instead.
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

function makeSkeleton(returnValue: unknown) {
  return {
    invoke: vi.fn().mockResolvedValue(returnValue),
  } as unknown as SwarmAgentDef<S>["skeleton"];
}

function makeRegistry(): AgentRegistry<S> {
  return new AgentRegistry<S>();
}

const swarmLiveState = {
  hasSupervisor: false,
  supervisorNodeName: "__supervisor__",
  onErrorPolicy: "throw" as const,
};

describe("BUG-0399 — normal completion path must filter __-prefixed keys from result.context", () => {
  it("__-prefixed keys returned by agent skeleton do not appear in the output context", async () => {
    // A compromised skeleton returns a context with privileged keys
    const skeleton = makeSkeleton({
      context: {
        normalKey: "safe-value",
        __deadlineAbsolute: 9_999_999_999_999,   // attacker tries to extend deadline
        __injectedPrivilege: "escalated",         // arbitrary privilege escalation
        __consumedMsgIds: ["fake-id-1"],           // attacker tries to corrupt consumed set
      },
    });

    const def: SwarmAgentDef<S> = {
      id: "agent-a",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
    };

    const registry = makeRegistry();
    registry.register(def);

    const nodeFn = createAgentNode(def, registry, swarmLiveState);
    const state = makeState();

    const result = await nodeFn(state) as Partial<S>;

    const outCtx = result?.context as Record<string, unknown>;

    // Normal keys from the agent result should pass through
    expect(outCtx).toHaveProperty("normalKey", "safe-value");

    // __-prefixed keys supplied by the agent must be filtered out
    expect(outCtx).not.toHaveProperty("__deadlineAbsolute");
    expect(outCtx).not.toHaveProperty("__injectedPrivilege");

    // __consumedMsgIds must be set by the runtime (empty array here — no
    // inbox messages), not overwritten by the agent-supplied value.
    // The runtime always re-derives this from newConsumedIds.
    expect(outCtx["__consumedMsgIds"]).not.toContain("fake-id-1");
  });

  it("non-__ keys from result.context are preserved in the output", async () => {
    const skeleton = makeSkeleton({
      context: {
        output: "hello",
        step: 3,
        metadata: { confidence: 0.9 },
      },
    });

    const def: SwarmAgentDef<S> = {
      id: "agent-b",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
    };

    const registry = makeRegistry();
    registry.register(def);

    const nodeFn = createAgentNode(def, registry, swarmLiveState);
    const state = makeState({ currentAgent: "agent-b" });

    const result = await nodeFn(state) as Partial<S>;

    const outCtx = result?.context as Record<string, unknown>;

    expect(outCtx).toHaveProperty("output", "hello");
    expect(outCtx).toHaveProperty("step", 3);
    expect(outCtx).toHaveProperty("metadata");
    expect((outCtx["metadata"] as Record<string, unknown>)["confidence"]).toBe(0.9);
  });

  it("__consumedMsgIds in output is always the runtime-derived value, not an agent-supplied one", async () => {
    // Even if the agent returns a completely different __consumedMsgIds,
    // the runtime value (derived from state.context.__consumedMsgIds + inbox)
    // must win — an attacker must not be able to replay already-consumed
    // messages by clearing the consumed set.
    const skeleton = makeSkeleton({
      context: {
        __consumedMsgIds: [],  // attacker tries to clear the consumed set
      },
    });

    const def: SwarmAgentDef<S> = {
      id: "agent-c",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
    };

    const registry = makeRegistry();
    registry.register(def);

    const nodeFn = createAgentNode(def, registry, swarmLiveState);

    // Simulate a state where a message was already consumed
    const state = makeState({
      currentAgent: "agent-c",
      context: { __consumedMsgIds: ["already-consumed-msg"] },
    });

    const result = await nodeFn(state) as Partial<S>;

    const outCtx = result?.context as Record<string, unknown>;
    const consumedIds = outCtx["__consumedMsgIds"] as string[];

    // The already-consumed ID must still be present — the agent cannot
    // clear the consumed set by returning an empty __consumedMsgIds.
    expect(consumedIds).toContain("already-consumed-msg");
  });
});
