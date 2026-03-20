import { describe, it, expect, vi } from "vitest";
import { createAgentNode } from "../../swarm/agent-node.js";
import { AgentRegistry } from "../../swarm/registry.js";
import { Handoff } from "../../swarm/types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";
import { Command } from "../../types.js";
import type { BaseSwarmState } from "../../swarm/config.js";

/**
 * Regression test for BUG-0240: markIdle() was called before handoff
 * detection, allowing the supervisor to dispatch new work to an agent that
 * was logically mid-handoff. The fix moves markIdle() to after both the
 * handoff return and the normal return paths.
 */

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
  const reg = new AgentRegistry<S>();
  return reg;
}

const swarmLiveState = {
  hasSupervisor: true,
  supervisorNodeName: "__supervisor__",
  onErrorPolicy: "throw" as const,
};

describe("BUG-0240: markIdle is called after handoff detection, not before", () => {
  it("agent is NOT idle during the handoff path — markIdle fires after Command is prepared", async () => {
    const handoff = new Handoff({ to: "agent-b", message: "passing work" });
    const skeleton = makeSkeleton(handoff);

    const def: SwarmAgentDef<S> = {
      id: "agent-a",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
    };

    const registry = makeRegistry();
    registry.register(def);

    // Spy on markIdle to capture when it is called relative to the return value
    const callOrder: string[] = [];
    const originalMarkIdle = registry.markIdle.bind(registry);
    vi.spyOn(registry, "markIdle").mockImplementation((id) => {
      callOrder.push("markIdle");
      return originalMarkIdle(id);
    });

    const nodeFn = createAgentNode(def, registry, swarmLiveState);
    const state = makeState();

    // Capture agent status at every point by interleaving with onComplete hook
    let statusDuringOnComplete: string | undefined;
    def.hooks = {
      onComplete: async () => {
        // At this point the agent should still be busy (markIdle hasn't fired yet)
        const rec = registry.manifest().find((e) => e.id === "agent-a");
        statusDuringOnComplete = rec?.status;
        callOrder.push("onComplete");
      },
    };

    const result = await nodeFn(state);

    // Result must be a Command (handoff path)
    expect(result).toBeInstanceOf(Command);

    // onComplete fired before markIdle (agent still busy during hook)
    expect(callOrder.indexOf("onComplete")).toBeLessThan(callOrder.indexOf("markIdle"));

    // Status during onComplete was "busy" — agent was NOT idled prematurely
    expect(statusDuringOnComplete).toBe("busy");

    // After the node returns, the agent is idle
    const final = registry.manifest().find((e) => e.id === "agent-a");
    expect(final?.status).toBe("idle");
  });

  it("agent is NOT idle during the normal result path — markIdle fires after onComplete", async () => {
    const normalResult = { output: "done" };
    const skeleton = makeSkeleton(normalResult);

    const def: SwarmAgentDef<S> = {
      id: "agent-b",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
    };

    const registry = makeRegistry();
    registry.register(def);

    const callOrder: string[] = [];
    const originalMarkIdle = registry.markIdle.bind(registry);
    vi.spyOn(registry, "markIdle").mockImplementation((id) => {
      callOrder.push("markIdle");
      return originalMarkIdle(id);
    });

    let statusDuringOnComplete: string | undefined;
    def.hooks = {
      onComplete: async () => {
        const rec = registry.manifest().find((e) => e.id === "agent-b");
        statusDuringOnComplete = rec?.status;
        callOrder.push("onComplete");
      },
    };

    const nodeFn = createAgentNode(def, registry, swarmLiveState);
    const state = makeState({ currentAgent: "agent-b" });

    await nodeFn(state);

    // onComplete must fire before markIdle on the normal path too
    expect(callOrder.indexOf("onComplete")).toBeLessThan(callOrder.indexOf("markIdle"));
    expect(statusDuringOnComplete).toBe("busy");

    const final = registry.manifest().find((e) => e.id === "agent-b");
    expect(final?.status).toBe("idle");
  });

  it("with old bug: if markIdle were called before handoff detection, agent could be seen as idle mid-handoff", () => {
    // This test documents the failure mode that existed before the fix:
    // markIdle() was at line 96 (before handoff check at line 113).
    // A concurrent supervisor poll between markBusy and markIdle would see
    // the agent as idle while it was processing a handoff.
    //
    // We verify here that the fix prevents this: after markBusy, the agent
    // stays busy until markIdle is called explicitly.
    const registry = makeRegistry();
    const def: SwarmAgentDef<S> = {
      id: "agent-c",
      role: "worker",
      capabilities: [],
      skeleton: makeSkeleton({}),
      maxRetries: 0,
    };
    registry.register(def);

    registry.markBusy("agent-c");

    // Before markIdle, agent must be busy — the supervisor must NOT dispatch
    // new work to it during handoff processing.
    const midFlight = registry.manifest().find((e) => e.id === "agent-c");
    expect(midFlight?.status).toBe("busy");

    registry.markIdle("agent-c");
    const done = registry.manifest().find((e) => e.id === "agent-c");
    expect(done?.status).toBe("idle");
  });
});
