/**
 * Regression tests for BUG-0263
 *
 * Duck-typed Handoff detection at line 105 of agent-node.ts previously checked
 * only `(result as any).isHandoff` without verifying `.opts` exists, so a
 * duck-typed object `{ isHandoff: true }` with no `opts` property would call
 * `new Handoff(undefined)`, producing a malformed Handoff.
 *
 * The fix added `&& (result as any).opts` to the guard so that only duck-typed
 * objects that carry a valid `opts` payload are treated as Handoff routing
 * directives.
 *
 * These tests exercise the FIXED paths to confirm correct behaviour:
 *   1. A real `Handoff` instance is routed correctly.
 *   2. A duck-typed `{ isHandoff: true, opts: {...} }` returned directly from a
 *      raw NodeFn (not wrapped in a skeleton) routes correctly.
 */
import { describe, it, expect } from "vitest";
import { createAgentNode } from "../../swarm/agent-node.js";
import { Handoff, type BaseSwarmState } from "../../swarm/index.js";
import type { AgentRegistry } from "../../swarm/registry.js";
import { START, END, StateGraph, lastValue, appendList, mergeObject } from "../../index.js";

// --------------------------------------------------------------------------
// Minimal helpers
// --------------------------------------------------------------------------

function makeChannels() {
  return {
    task: lastValue(() => ""),
    context: mergeObject(() => ({})),
    agentResults: mergeObject(() => ({})),
    messages: appendList(() => [] as Array<{ role: string; content: string }>),
    swarmMessages: appendList(() => []),
    supervisorRound: lastValue(() => 0),
    currentAgent: lastValue(() => null as string | null),
    done: lastValue(() => false),
    handoffHistory: appendList(() => []),
  };
}

function buildSkeleton(handler: (state: any) => any) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", handler);
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

function makeRegistry(id: string): AgentRegistry<BaseSwarmState> {
  const agentState: Record<string, "idle" | "busy" | "error"> = { [id]: "idle" };
  return {
    markBusy: (i) => { agentState[i] = "busy"; },
    markIdle: (i) => { agentState[i] = "idle"; },
    markError: (i) => { agentState[i] = "error"; },
    getStatus: (i) => agentState[i] ?? "idle",
    allAgentIds: () => [id],
    hasAgent: (i) => i in agentState,
  } as unknown as AgentRegistry<BaseSwarmState>;
}

const swarmState = {
  hasSupervisor: false,
  supervisorNodeName: "__supervisor__",
  onErrorPolicy: "throw" as const,
};

function makeBaseState(): BaseSwarmState {
  return {
    task: "test",
    context: {},
    agentResults: {},
    messages: [],
    swarmMessages: [],
    supervisorRound: 0,
    currentAgent: null,
    done: false,
    handoffHistory: [],
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("BUG-0263: duck-typed Handoff opts guard", () => {
  it("a real Handoff instance returned from a skeleton is routed to the target agent", async () => {
    const registry = makeRegistry("a");
    const node = createAgentNode<BaseSwarmState>(
      {
        id: "a",
        role: "Agent A",
        capabilities: [],
        skeleton: buildSkeleton(() => new Handoff({ to: "b", message: "pass to b" })) as any,
      },
      registry,
      swarmState,
    );

    const result = await node(makeBaseState());

    // Should produce a Command with goto: "b"
    expect(result).toBeDefined();
    expect((result as any).goto).toBe("b");
  });

  it("BUG-0263: duck-typed { isHandoff: true, opts: {...} } in __pendingHandoff routes correctly", async () => {
    // When a raw duck-typed handoff is pre-stored in __pendingHandoff (e.g. from
    // a foreign agent framework), createAgentNode should pick it up and route.
    const registry = makeRegistry("a");
    // Create a node whose skeleton.invoke() returns __pendingHandoff directly
    const fakeSkeleton = {
      invoke: async () => ({
        __pendingHandoff: { isHandoff: true, opts: { to: "c", message: "duck to c" } },
      }),
    };

    const node = createAgentNode<BaseSwarmState>(
      {
        id: "a",
        role: "Agent A",
        capabilities: [],
        skeleton: fakeSkeleton as any,
      },
      registry,
      swarmState,
    );

    const result = await node(makeBaseState());
    expect((result as any).goto).toBe("c");
  });

  it("BUG-0263: direct duck-typed { isHandoff: true, opts: {...} } returned by skeleton.invoke() routes correctly", async () => {
    // Direct case: skeleton.invoke() returns the duck-typed object at top level
    const registry = makeRegistry("a");
    const fakeSkeleton = {
      invoke: async () => ({
        isHandoff: true,
        opts: { to: "d", message: "duck to d" },
      }),
    };

    const node = createAgentNode<BaseSwarmState>(
      {
        id: "a",
        role: "Agent A",
        capabilities: [],
        skeleton: fakeSkeleton as any,
      },
      registry,
      swarmState,
    );

    const result = await node(makeBaseState());
    expect((result as any).goto).toBe("d");
  });
});
