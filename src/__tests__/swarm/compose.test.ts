import { describe, it, expect } from "vitest";
import {
  SwarmGraph, quickAgent, type BaseSwarmState,
} from "../../swarm/index.js";

describe("SwarmGraph.compose()", () => {
  it("chains sub-swarms as pipeline stages", async () => {
    // Stage 1: a fan-out swarm
    const fanout = SwarmGraph.fanOut<BaseSwarmState>({
      agents: [
        quickAgent("search-web", async () => ({
          messages: [{ role: "assistant", content: "web results" }],
        })),
        quickAgent("search-papers", async () => ({
          messages: [{ role: "assistant", content: "paper results" }],
        })),
      ],
      reducer: (results) => ({
        context: { researchDone: true, sourceCount: Object.keys(results).length },
      }),
    });

    // Stage 2: a simple pipeline swarm
    const synthesis = SwarmGraph.pipeline<BaseSwarmState>({
      stages: [
        quickAgent("synthesizer", async (state) => {
          const ctx = state.context as Record<string, unknown>;
          return {
            messages: [{ role: "assistant", content: `Synthesized ${ctx.sourceCount} sources` }],
            done: true,
          };
        }),
      ],
    });

    // Compose: fanout → synthesis
    const composed = SwarmGraph.compose<BaseSwarmState>({
      stages: [
        { id: "research", swarm: fanout },
        { id: "synthesis", swarm: synthesis },
      ],
    });

    const app = composed.compile();
    const result = await app.invoke({ task: "AI trends" });

    // Research stage should have run (context.researchDone set)
    expect((result.context as Record<string, unknown>).researchDone).toBe(true);
    // Synthesis stage should have completed
    expect(result.done).toBe(true);
    // Both stages recorded in agentResults
    expect(result.agentResults.research).toBeDefined();
    expect(result.agentResults.synthesis).toBeDefined();
  });

  it("single-stage compose works (edge case)", async () => {
    const inner = SwarmGraph.pipeline<BaseSwarmState>({
      stages: [
        quickAgent("solo", async () => ({
          messages: [{ role: "assistant", content: "solo done" }],
          done: true,
        })),
      ],
    });

    const composed = SwarmGraph.compose<BaseSwarmState>({
      stages: [{ id: "only", swarm: inner }],
    });

    const app = composed.compile();
    const result = await app.invoke({ task: "single compose" });

    expect(result.done).toBe(true);
    expect(result.agentResults.only).toBeDefined();
  });

  it("state flows through stages — later stages see earlier results", async () => {
    const receivedContext: Record<string, unknown>[] = [];

    const stage1 = SwarmGraph.pipeline<BaseSwarmState>({
      stages: [
        quickAgent("tagger", async () => ({
          context: { tagged: true, priority: "high" },
        })),
      ],
    });

    const stage2 = SwarmGraph.pipeline<BaseSwarmState>({
      stages: [
        quickAgent("processor", async (state) => {
          receivedContext.push({ ...(state.context as Record<string, unknown>) });
          return {
            messages: [{ role: "assistant", content: "processed" }],
            done: true,
          };
        }),
      ],
    });

    const composed = SwarmGraph.compose<BaseSwarmState>({
      stages: [
        { id: "tag", swarm: stage1 },
        { id: "process", swarm: stage2 },
      ],
    });

    const app = composed.compile();
    await app.invoke({ task: "flow test" });

    // Stage 2 should have seen context set by stage 1
    expect(receivedContext.length).toBe(1);
    expect(receivedContext[0]!.tagged).toBe(true);
    expect(receivedContext[0]!.priority).toBe("high");
  });
});
