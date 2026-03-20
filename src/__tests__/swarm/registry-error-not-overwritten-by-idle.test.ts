import { describe, it, expect } from "vitest";
import { AgentRegistry } from "../../swarm/registry.js";
import { StateGraph } from "../../graph.js";
import { START, END } from "../../types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

/**
 * Regression test for BUG-0011: When an agent has maxConcurrency > 1 and one
 * task errors while another completes normally, markIdle() must not overwrite
 * the error status back to "idle". The pendingError latch introduced by the fix
 * defers the error status until all active tasks have settled.
 */

type S = Record<string, unknown>;

function makeDef(id: string): SwarmAgentDef<S> {
  const g = new StateGraph<S>({ channels: {} as never });
  g.addNode("work", () => ({}));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: "worker", capabilities: [], skeleton: g.compile(), maxRetries: 0 };
}

describe("BUG-0011: concurrent task error is preserved by markIdle", () => {
  it("BUG-0011: error status not overwritten when sibling task completes normally", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("agent-x"));

    // Start two concurrent tasks
    reg.markBusy("agent-x"); // task A
    reg.markBusy("agent-x"); // task B

    // Task A errors — with the fix, status should NOT immediately become "error"
    // while task B is still running; the error is latched via pendingError.
    reg.markError("agent-x");

    // Agent still has one active task, so status should be "busy" (not error yet)
    const mid = reg.manifest().find((e) => e.id === "agent-x")!;
    expect(mid.activeTasks).toBe(1);

    // Task B completes normally — before the fix, markIdle would set status="idle"
    // overwriting the error. With the fix, pendingError is consumed and final
    // status is "error".
    reg.markIdle("agent-x");

    const final = reg.manifest().find((e) => e.id === "agent-x")!;
    expect(final.status).toBe("error");
    expect(final.activeTasks).toBe(0);
    expect(final.errors).toBe(1);
  });

  it("BUG-0011: agent with no concurrent error becomes idle when task completes", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("agent-y"));

    reg.markBusy("agent-y");
    reg.markIdle("agent-y");

    const agent = reg.manifest().find((e) => e.id === "agent-y")!;
    expect(agent.status).toBe("idle");
    expect(agent.activeTasks).toBe(0);
  });
});
