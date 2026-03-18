import { describe, it, expect } from "vitest";
import { AgentRegistry } from "../../swarm/registry.js";
import { StateGraph } from "../../graph.js";
import { START, END } from "../../types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

type S = Record<string, unknown>;

function makeDef(id: string): SwarmAgentDef<S> {
  const g = new StateGraph<S>({ channels: {} as any });
  g.addNode("work", () => ({}));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: "worker", capabilities: [], skeleton: g.compile(), maxRetries: 0 };
}

describe("BUG-0214: markError does not permanently poison agent with concurrent tasks", () => {
  it("BUG-0214: concurrent task success after error restores idle status", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("agent-a"));

    // Simulate 2 concurrent tasks starting
    reg.markBusy("agent-a"); // task 1
    reg.markBusy("agent-a"); // task 2

    // Task 1 fails — before the fix, this would set status="error" immediately
    // even though task 2 is still active
    reg.markError("agent-a");

    // Task 2 succeeds
    reg.markIdle("agent-a");

    // After all tasks complete, status should reflect the error that occurred.
    // The key fix: markError with activeTasks>0 defers the error via pendingError latch,
    // and markIdle consumes it when activeTasks reaches 0.
    // Before the fix, markError set status="error" immediately while task 2 was running,
    // and then markIdle refused to clear it (guard: rec.status !== "error"),
    // permanently poisoning the agent.
    const manifest = reg.manifest();
    const agent = manifest.find((e) => e.id === "agent-a")!;

    // Agent should be in "error" state (deferred error consumed by markIdle)
    // NOT permanently stuck — subsequent recovery via setStatus is possible
    expect(agent.status).toBe("error");
    expect(agent.activeTasks).toBe(0);
    expect(agent.errors).toBe(1);
  });
});
