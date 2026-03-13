import { describe, it, expect, vi } from "vitest";
import {
  SwarmGraph, Handoff,
  type BaseSwarmState,
} from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";

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

function buildSimpleSkeleton(handler: (state: any) => any) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", handler);
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

describe("Handoff execution", () => {
  it("agent returning Handoff routes to target agent", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    // Agent A returns a Handoff to agent B
    swarm.addAgent({
      id: "agentA",
      role: "Starter",
      capabilities: [{ name: "start", description: "starts" }],
      skeleton: buildSimpleSkeleton(() => {
        return new Handoff({
          to: "agentB",
          message: "Please handle this",
          context: { fromA: true },
        });
      }) as any,
    });

    // Agent B completes the task
    swarm.addAgent({
      id: "agentB",
      role: "Finisher",
      capabilities: [{ name: "finish", description: "finishes" }],
      skeleton: buildSimpleSkeleton(() => ({
        done: true,
        messages: [{ role: "assistant", content: "Done by B" }],
      })) as any,
    });

    // Wire: START → agentA, agentA/agentB → END (via conditional)
    swarm.addEdge(START, "agentA");
    swarm.addConditionalHandoff("agentB", (state) => END);

    const app = swarm.compile();
    const result = await app.invoke({ task: "test handoff" });

    // agentB should have run
    expect(result.done).toBe(true);
    expect(result.messages.some((m: any) => m.content === "Done by B")).toBe(true);
    // Handoff should be recorded
    expect(result.handoffHistory.some(
      (h: any) => h.from === "agentA" && h.to === "agentB"
    )).toBe(true);
  });

  it("agent returning Handoff merges context into state", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "sender",
      role: "Sender",
      capabilities: [],
      skeleton: buildSimpleSkeleton(() => {
        return new Handoff({
          to: "receiver",
          message: "Here is data",
          context: { secret: 42 },
        });
      }) as any,
    });

    let receivedContext: any = null;
    swarm.addAgent({
      id: "receiver",
      role: "Receiver",
      capabilities: [],
      skeleton: buildSimpleSkeleton((state: any) => {
        receivedContext = state.context;
        return { done: true };
      }) as any,
    });

    swarm.addEdge(START, "sender");
    swarm.addConditionalHandoff("receiver", () => END);

    const app = swarm.compile();
    await app.invoke({ task: "context test" });

    expect(receivedContext).toBeDefined();
    expect(receivedContext.secret).toBe(42);
  });

  it("agent NOT returning Handoff works normally", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "normal",
      role: "Normal",
      capabilities: [],
      skeleton: buildSimpleSkeleton(() => ({
        messages: [{ role: "assistant", content: "Normal result" }],
        done: true,
      })) as any,
    });

    swarm.addEdge(START, "normal");
    swarm.addConditionalHandoff("normal", (state) =>
      state.done ? END : "normal"
    );

    const app = swarm.compile();
    const result = await app.invoke({ task: "normal test" });

    expect(result.done).toBe(true);
    expect(result.messages.some((m: any) => m.content === "Normal result")).toBe(true);
  });
});
