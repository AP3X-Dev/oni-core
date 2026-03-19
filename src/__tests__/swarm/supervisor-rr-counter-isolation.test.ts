import { describe, it, expect, vi } from "vitest";
import { createSupervisorNode } from "../../swarm/supervisor.js";
import { AgentRegistry } from "../../swarm/registry.js";
import type { SwarmAgentDef } from "../../swarm/types.js";
import { Command } from "../../types.js";

/**
 * BUG-0070 regression: rrCounter was a module-level global shared across all
 * createSupervisorNode instances, causing non-deterministic per-instance
 * round-robin routing when multiple SwarmGraph instances ran concurrently.
 *
 * Fix: routeRoundRobin now receives `counter` as the per-state `supervisorRound`
 * value so each supervisor instance has an independent, deterministic counter
 * derived from its own state rather than a shared mutable module variable.
 */
describe("BUG-0070: supervisor round-robin counter isolation", () => {
  function makeAgent(id: string): SwarmAgentDef {
    return {
      id,
      role: "worker",
      capabilities: [{ name: "test", description: "test" }],
      skeleton: { invoke: vi.fn(), stream: vi.fn() } as any,
    } as SwarmAgentDef;
  }

  function makeState(round: number) {
    return {
      task: "do something",
      context: {},
      supervisorRound: round,
      currentAgent: null,
      agentResults: {},
      messages: [],
      done: false,
      swarmMessages: [],
      handoffHistory: [],
    };
  }

  function extractGoto(result: unknown): string | symbol | null | undefined {
    if (result instanceof Command) {
      return result.goto as string | symbol | null | undefined;
    }
    return null;
  }

  it("BUG-0070: two independent supervisor instances at the same round select the same agent (counter is per-state, not module-global)", async () => {
    // Instance 1 — fresh registry
    const registry1 = new AgentRegistry();
    registry1.register(makeAgent("agent-a"));
    registry1.register(makeAgent("agent-b"));

    // Instance 2 — completely separate registry
    const registry2 = new AgentRegistry();
    registry2.register(makeAgent("agent-a"));
    registry2.register(makeAgent("agent-b"));

    const supervisor1 = createSupervisorNode(registry1, { strategy: "round-robin" });
    const supervisor2 = createSupervisorNode(registry2, { strategy: "round-robin" });

    // Drive supervisor2 at round 0 FIRST — with the old module-global bug this
    // would increment the shared counter, so supervisor1's round-0 call would
    // see counter=1 instead of counter=0 and select a different agent.
    const result2Round0 = await supervisor2(makeState(0) as any);
    const result1Round0 = await supervisor1(makeState(0) as any);

    const goto1 = extractGoto(result1Round0);
    const goto2 = extractGoto(result2Round0);

    // Both supervisors independently, at round 0, should select the same agent
    // because round-robin uses the state-bound `supervisorRound` (0), not any
    // shared mutable counter.
    expect(goto1).not.toBeNull();
    expect(goto2).not.toBeNull();
    expect(goto1).toBe(goto2);
  });

  it("BUG-0070: routing at round 0 vs round 1 is deterministic and consistent across calls", async () => {
    const registry = new AgentRegistry();
    registry.register(makeAgent("agent-a"));
    registry.register(makeAgent("agent-b"));

    const supervisor = createSupervisorNode(registry, { strategy: "round-robin" });

    // Calling with the same round value should always pick the same agent
    // (idempotent per round).
    const r0a = await supervisor(makeState(0) as any);
    const r0b = await supervisor(makeState(0) as any);

    expect(extractGoto(r0a)).toBe(extractGoto(r0b));

    // Round 1 should select the other agent (actual rotation).
    const r1 = await supervisor(makeState(1) as any);
    expect(extractGoto(r1)).not.toBeNull();
    // Round 0 and round 1 should differ (round-robin advances).
    expect(extractGoto(r1)).not.toBe(extractGoto(r0a));
  });
});
