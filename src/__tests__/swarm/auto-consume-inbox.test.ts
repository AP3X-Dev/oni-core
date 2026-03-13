import { describe, it, expect } from "vitest";
import {
  SwarmGraph, type BaseSwarmState,
} from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";
import { createMessage } from "../../swarm/mailbox.js";

function makeChannels() {
  return {
    task: lastValue(() => ""),
    context: mergeObject(() => ({})),
    agentResults: mergeObject(() => ({})),
    messages: appendList(() => [] as Array<{ role: string; content: string }>),
    swarmMessages: appendList(() => [] as any[]),
    supervisorRound: lastValue(() => 0),
    currentAgent: lastValue(() => null as string | null),
    done: lastValue(() => false),
    handoffHistory: appendList(() => []),
  };
}

describe("Auto-consume inbox", () => {
  it("agent does not see the same messages twice across invocations", async () => {
    const inboxSnapshots: number[] = [];

    // An agent that records inbox size each time it runs
    const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
    g.addNode("work", async (state) => {
      const inbox = ((state.context as Record<string, unknown>).inbox ?? []) as unknown[];
      inboxSnapshots.push(inbox.length);
      return {
        messages: [{ role: "assistant", content: `saw ${inbox.length} messages` }],
      };
    });
    g.addEdge(START, "work");
    g.addEdge("work", END);

    const swarm = new SwarmGraph<BaseSwarmState>();
    swarm.addAgent({
      id: "reader",
      role: "Reader",
      capabilities: [],
      skeleton: g.compile() as any,
    });

    // Supervised swarm so agent runs multiple rounds
    swarm.addSupervisor({
      strategy: "round-robin",
      taskField: "task",
      maxRounds: 3,
    });

    const app = swarm.compile();

    // Pre-seed a message for "reader"
    const msg = createMessage("system", "reader", "Hello from system");

    const result = await app.invoke({
      task: "test inbox",
      swarmMessages: [msg],
    });

    // First invocation: sees 1 message
    // Second invocation: message was consumed, sees 0
    expect(inboxSnapshots[0]).toBe(1);
    if (inboxSnapshots.length > 1) {
      expect(inboxSnapshots[1]).toBe(0);
    }
  });

  it("consuming one agent's inbox doesn't eat another agent's messages", async () => {
    const inboxContents: Record<string, string[]> = { alpha: [], beta: [] };

    // Supervised swarm: supervisor routes to alpha first, then beta
    const makeTracked = (id: string) => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        const inbox = ((state.context as Record<string, unknown>).inbox ?? []) as Array<{ content: string }>;
        inboxContents[id]!.push(...inbox.map((m) => m.content));
        return {
          messages: [{ role: "assistant", content: `${id} done` }],
          done: id === "beta", // beta ends the swarm
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id,
        role: id,
        capabilities: [],
        skeleton: g.compile() as any,
      };
    };

    const swarm = new SwarmGraph<BaseSwarmState>();
    swarm.addAgent(makeTracked("alpha"));
    swarm.addAgent(makeTracked("beta"));

    // Rule-based supervisor: alpha on round 0, beta on round 1
    swarm.addSupervisor({
      strategy: "rule",
      taskField: "task",
      rules: [
        { condition: (_, ctx) => (ctx as Record<string, unknown>).supervisorRound === 0, agentId: "alpha" },
        { condition: () => true, agentId: "beta" },
      ],
      maxRounds: 3,
    });

    const app = swarm.compile();

    const msgForAlpha = createMessage("system", "alpha", "alpha-msg");
    const msgForBeta = createMessage("system", "beta", "beta-msg");

    await app.invoke({
      task: "isolation test",
      swarmMessages: [msgForAlpha, msgForBeta],
    });

    // Alpha saw only its message
    expect(inboxContents.alpha).toContain("alpha-msg");
    expect(inboxContents.alpha).not.toContain("beta-msg");
    // Beta saw only its message
    expect(inboxContents.beta).toContain("beta-msg");
    expect(inboxContents.beta).not.toContain("alpha-msg");
  });

  it("broadcast messages are consumed per-agent", async () => {
    const inboxSizes: number[] = [];

    const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
    g.addNode("work", async (state) => {
      const inbox = ((state.context as Record<string, unknown>).inbox ?? []) as unknown[];
      inboxSizes.push(inbox.length);
      return { messages: [{ role: "assistant", content: "done" }] };
    });
    g.addEdge(START, "work");
    g.addEdge("work", END);

    const swarm = new SwarmGraph<BaseSwarmState>();
    swarm.addAgent({
      id: "worker",
      role: "Worker",
      capabilities: [],
      skeleton: g.compile() as any,
    });

    swarm.addSupervisor({
      strategy: "round-robin",
      taskField: "task",
      maxRounds: 3,
    });

    const app = swarm.compile();

    // Broadcast message
    const broadcast = createMessage("system", "*", "Broadcast to all");

    const result = await app.invoke({
      task: "broadcast test",
      swarmMessages: [broadcast],
    });

    // First run sees the broadcast, subsequent runs don't
    expect(inboxSizes[0]).toBe(1);
    if (inboxSizes.length > 1) {
      expect(inboxSizes[1]).toBe(0);
    }
  });
});
