import { describe, it, expect, vi } from "vitest";
import { createAgentNode } from "../../swarm/agent-node.js";
import { AgentRegistry } from "../../swarm/registry.js";
import { Handoff } from "../../swarm/types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";
import type { BaseSwarmState } from "../../swarm/config.js";

/**
 * Regression test for BUG-0305:
 *
 * `onComplete` hook was awaited without try/catch on both the handoff path
 * (line 119) and the normal return path (line 139) of createAgentNode().
 * If onComplete threw, `registry.markIdle()` was never called, permanently
 * leaving the agent in "busy" state (activeTasks > 0, status "busy").
 *
 * The fix wraps both onComplete calls in try/catch/finally blocks so that
 * markIdle() always runs regardless of whether onComplete throws.
 *
 * Verified by commit c8e3070 on main.
 */

type S = BaseSwarmState & Record<string, unknown>;

function makeState(overrides: Partial<S> = {}): S {
  return {
    swarmMessages: [],
    agentResults: {},
    handoffHistory: [],
    supervisorRound: 0,
    currentAgent: "test-agent",
    context: {},
    ...overrides,
  } as S;
}

const swarmLiveState = {
  hasSupervisor: false,
  supervisorNodeName: "__supervisor__",
  onErrorPolicy: "throw" as const,
};

describe("BUG-0305: markIdle always called even when onComplete hook throws", () => {
  it("agent status returns to idle after onComplete throws on normal return path", async () => {
    const skeleton = {
      invoke: vi.fn().mockResolvedValue({ agentResults: { "test-agent": "done" } }),
    } as unknown as SwarmAgentDef<S>["skeleton"];

    const registry = new AgentRegistry<S>();

    const def: SwarmAgentDef<S> = {
      id: "test-agent",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
      hooks: {
        onComplete: async () => {
          throw new Error("onComplete hook exploded");
        },
      },
    };

    registry.register(def);

    const nodeFn = createAgentNode(def, registry, swarmLiveState);
    const state = makeState();

    // Node invocation should NOT throw (onComplete error is caught by the fix)
    await expect(nodeFn(state)).resolves.toBeDefined();

    // The critical assertion: agent must be idle, not permanently busy
    const rec = registry.manifest().find((e) => e.id === "test-agent");
    expect(rec).toBeDefined();
    expect(rec!.status).toBe("idle");
    expect(rec!.activeTasks).toBe(0);
  });

  it("agent status returns to idle after onComplete throws on handoff path", async () => {
    const handoff = new Handoff({ to: "next-agent", message: "pass" });
    const skeleton = {
      invoke: vi.fn().mockResolvedValue(handoff),
    } as unknown as SwarmAgentDef<S>["skeleton"];

    const registry = new AgentRegistry<S>();

    const def: SwarmAgentDef<S> = {
      id: "test-agent",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
      hooks: {
        onComplete: async () => {
          throw new Error("onComplete hook exploded during handoff");
        },
      },
    };

    registry.register(def);

    const nodeFn = createAgentNode(def, registry, swarmLiveState);
    const state = makeState();

    // Handoff path should also succeed (returns a Command)
    const result = await nodeFn(state);
    expect(result).toBeDefined();

    // The agent must be idle even though onComplete threw
    const rec = registry.manifest().find((e) => e.id === "test-agent");
    expect(rec).toBeDefined();
    expect(rec!.status).toBe("idle");
    expect(rec!.activeTasks).toBe(0);
  });

  it("onComplete success case still marks agent idle", async () => {
    const completedWith: unknown[] = [];
    const skeleton = {
      invoke: vi.fn().mockResolvedValue({ agentResults: { "test-agent": "success" } }),
    } as unknown as SwarmAgentDef<S>["skeleton"];

    const registry = new AgentRegistry<S>();

    const def: SwarmAgentDef<S> = {
      id: "test-agent",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
      hooks: {
        onComplete: async (_id, result) => {
          completedWith.push(result);
        },
      },
    };

    registry.register(def);

    const nodeFn = createAgentNode(def, registry, swarmLiveState);
    const state = makeState();

    await nodeFn(state);

    expect(completedWith).toHaveLength(1);
    const rec = registry.manifest().find((e) => e.id === "test-agent");
    expect(rec!.status).toBe("idle");
  });

  it("multiple sequential invocations remain stable when onComplete always throws", async () => {
    const skeleton = {
      invoke: vi.fn().mockResolvedValue({ agentResults: { "test-agent": "ok" } }),
    } as unknown as SwarmAgentDef<S>["skeleton"];

    const registry = new AgentRegistry<S>();

    const def: SwarmAgentDef<S> = {
      id: "test-agent",
      role: "worker",
      capabilities: [],
      skeleton,
      maxRetries: 0,
      hooks: {
        onComplete: async () => {
          throw new Error("always throws");
        },
      },
    };

    registry.register(def);

    for (let i = 0; i < 3; i++) {
      const nodeFn = createAgentNode(def, registry, swarmLiveState);
      await expect(nodeFn(makeState())).resolves.toBeDefined();

      const rec = registry.manifest().find((e) => e.id === "test-agent");
      expect(rec!.status).toBe("idle");
      expect(rec!.activeTasks).toBe(0);
    }
  });
});
