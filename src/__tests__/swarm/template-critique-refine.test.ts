import { describe, it, expect, vi } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
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

describe("SwarmGraph.critiqueRefine()", () => {
  it("freeform: terminates when critic approves", async () => {
    const generatorCallCount = { n: 0 };
    const criticCallCount = { n: 0 };

    const generator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        generatorCallCount.n++;
        return {
          context: {
            ...(state.context ?? {}),
            draft: `draft-${generatorCallCount.n}`,
          },
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id: "generator",
        role: "generator",
        capabilities: [],
        skeleton: g.compile() as any,
      };
    })();

    const critic = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        criticCallCount.n++;
        // Approve on the 2nd round (round=2 in context)
        const round = (state.context?.round as number) ?? 0;
        return {
          context: {
            ...(state.context ?? {}),
            approved: round >= 2,
          },
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id: "critic",
        role: "critic",
        capabilities: [],
        skeleton: g.compile() as any,
      };
    })();

    const swarm = SwarmGraph.critiqueRefine<BaseSwarmState>({
      generator,
      critic,
      feedback: "freeform",
      maxRounds: 5,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "write a poem" });

    expect(result.done).toBe(true);
    // Should have run exactly 2 generator+critic cycles
    expect(generatorCallCount.n).toBe(2);
    expect(criticCallCount.n).toBe(2);
  });

  it("freeform: terminates at maxRounds if never approved", async () => {
    const generatorCallCount = { n: 0 };
    const criticCallCount = { n: 0 };

    const generator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        generatorCallCount.n++;
        return { context: { ...(state.context ?? {}), draft: `draft-${generatorCallCount.n}` } };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id: "generator",
        role: "generator",
        capabilities: [],
        skeleton: g.compile() as any,
      };
    })();

    const critic = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        criticCallCount.n++;
        // Never approve
        return {
          context: {
            ...(state.context ?? {}),
            approved: false,
          },
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id: "critic",
        role: "critic",
        capabilities: [],
        skeleton: g.compile() as any,
      };
    })();

    const swarm = SwarmGraph.critiqueRefine<BaseSwarmState>({
      generator,
      critic,
      feedback: "freeform",
      maxRounds: 3,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "write a poem" });

    // Should terminate at maxRounds=3
    expect(result.done).toBe(true);
    expect(generatorCallCount.n).toBe(3);
    expect(criticCallCount.n).toBe(3);
  });

  it("rubric: terminates when all dimensions pass threshold", async () => {
    const generatorCallCount = { n: 0 };
    const criticCallCount = { n: 0 };

    const generator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        generatorCallCount.n++;
        return { context: { ...(state.context ?? {}), draft: `draft-${generatorCallCount.n}` } };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id: "generator",
        role: "generator",
        capabilities: [],
        skeleton: g.compile() as any,
      };
    })();

    const critic = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        criticCallCount.n++;
        const round = (state.context?.round as number) ?? 0;
        // Both dimensions pass on round 2
        const score = round >= 2 ? 0.9 : 0.5;
        return {
          context: {
            ...(state.context ?? {}),
            scores: [
              { dimension: "clarity", score, comment: "ok" },
              { dimension: "accuracy", score, comment: "ok" },
            ],
          },
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id: "critic",
        role: "critic",
        capabilities: [],
        skeleton: g.compile() as any,
      };
    })();

    const swarm = SwarmGraph.critiqueRefine<BaseSwarmState>({
      generator,
      critic,
      feedback: {
        dimensions: [
          { name: "clarity", description: "Is the output clear?", weight: 1 },
          { name: "accuracy", description: "Is the output accurate?", weight: 1 },
        ],
        passThreshold: 0.8,
      },
      maxRounds: 5,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "summarize the article" });

    expect(result.done).toBe(true);
    // Should have run 2 cycles — scores pass on round 2
    expect(generatorCallCount.n).toBe(2);
    expect(criticCallCount.n).toBe(2);
  });
});
