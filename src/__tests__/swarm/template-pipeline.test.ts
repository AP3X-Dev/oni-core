import { describe, it, expect } from "vitest";
import {
  SwarmGraph, type BaseSwarmState, type SwarmAgentDef,
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
    revisions: lastValue(() => 0),
  };
}

type PipeState = BaseSwarmState & { revisions: number };

function _buildAgent(id: string, response: string): SwarmAgentDef<PipeState> {
  const g = new StateGraph<PipeState>({ channels: makeChannels() as any });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant", content: response }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id, role: id, capabilities: [],
    skeleton: g.compile() as any,
  };
}

describe("SwarmGraph.pipeline()", () => {
  it("runs agents in sequence: A → B → C → END", async () => {
    const order: string[] = [];

    const makeTracked = (id: string): SwarmAgentDef<BaseSwarmState> => {
      const chs = {
        task: lastValue(() => ""),
        context: mergeObject(() => ({})),
        agentResults: mergeObject(() => ({})),
        messages: appendList(() => []),
        swarmMessages: appendList(() => []),
        supervisorRound: lastValue(() => 0),
        currentAgent: lastValue(() => null as string | null),
        done: lastValue(() => false),
        handoffHistory: appendList(() => []),
      };
      const g = new StateGraph<BaseSwarmState>({ channels: chs });
      g.addNode("work", async () => {
        order.push(id);
        return { messages: [{ role: "assistant", content: id }] };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return { id, role: id, capabilities: [], skeleton: g.compile() as any };
    };

    const swarm = SwarmGraph.pipeline<BaseSwarmState>({
      stages: [makeTracked("a"), makeTracked("b"), makeTracked("c")],
    });

    const app = swarm.compile();
    await app.invoke({ task: "pipeline test" });

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("supports conditional transitions (loop back)", async () => {
    let reviewCount = 0;

    const chs = makeChannels();
    const writerG = new StateGraph<PipeState>({ channels: chs as any });
    writerG.addNode("work", async () => ({
      messages: [{ role: "assistant", content: "Written" }],
    }));
    writerG.addEdge(START, "work");
    writerG.addEdge("work", END);

    const reviewerG = new StateGraph<PipeState>({ channels: chs as any });
    reviewerG.addNode("work", async (state) => {
      reviewCount++;
      const pass = reviewCount >= 2;
      return {
        messages: [{ role: "assistant", content: pass ? "Approved" : "Revise" }],
        done: pass,
        revisions: state.revisions + 1,
      };
    });
    reviewerG.addEdge(START, "work");
    reviewerG.addEdge("work", END);

    const swarm = SwarmGraph.pipeline<PipeState>({
      stages: [
        { id: "writer", role: "Writer", capabilities: [], skeleton: writerG.compile() as any },
        { id: "reviewer", role: "Reviewer", capabilities: [], skeleton: reviewerG.compile() as any },
      ],
      transitions: {
        reviewer: (state) => state.done ? END : "writer",
      },
      channels: chs as any,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "pipeline loop" });

    expect(result.done).toBe(true);
    expect(result.revisions).toBeGreaterThanOrEqual(2);
  });
});
