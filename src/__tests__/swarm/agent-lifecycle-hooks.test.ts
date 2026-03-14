import { describe, it, expect } from "vitest";
import {
  SwarmGraph, type BaseSwarmState,
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

function buildAgent(id: string, response: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant", content: response }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

function buildFailingAgent() {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => {
    throw new Error("agent crashed");
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

describe("Agent lifecycle hooks", () => {
  it("onStart and onComplete fire in order on successful execution", async () => {
    const events: string[] = [];

    const swarm = SwarmGraph.pipeline<BaseSwarmState>({
      stages: [{
        id: "worker",
        role: "Worker",
        capabilities: [],
        skeleton: buildAgent("worker", "done") as any,
        hooks: {
          onStart: (agentId) => { events.push(`start:${agentId}`); },
          onComplete: (agentId) => { events.push(`complete:${agentId}`); },
          onError: (agentId) => { events.push(`error:${agentId}`); },
        },
      }],
    });

    const app = swarm.compile();
    await app.invoke({ task: "test hooks" });

    expect(events).toEqual(["start:worker", "complete:worker"]);
  });

  it("onError fires after all retries are exhausted", async () => {
    const events: string[] = [];
    let capturedError: unknown;

    const swarm = new SwarmGraph<BaseSwarmState>();
    swarm.addAgent({
      id: "flaky",
      role: "Flaky",
      capabilities: [],
      skeleton: buildFailingAgent() as any,
      maxRetries: 1, // 1 retry = 2 attempts total
      hooks: {
        onStart: (agentId) => { events.push(`start:${agentId}`); },
        onComplete: (agentId) => { events.push(`complete:${agentId}`); },
        onError: (agentId, error) => {
          events.push(`error:${agentId}`);
          capturedError = error;
        },
      },
    });
    swarm.addEdge(START, "flaky");
    swarm.addConditionalHandoff("flaky", () => END);

    const app = swarm.compile();

    // Agent fails all retries — should throw since no supervisor
    await expect(app.invoke({ task: "fail" })).rejects.toThrow();

    // onStart should have fired, then onError (no onComplete)
    expect(events).toEqual(["start:flaky", "error:flaky"]);
    expect(capturedError).toBeInstanceOf(Error);
  });

  it("agents without hooks work unchanged (backwards-compatible)", async () => {
    const swarm = SwarmGraph.pipeline<BaseSwarmState>({
      stages: [{
        id: "plain",
        role: "Plain",
        capabilities: [],
        skeleton: buildAgent("plain", "no hooks") as any,
        // No hooks field at all
      }],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "no hooks test" });

    expect(result.done).toBeFalsy(); // pipeline doesn't set done
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
