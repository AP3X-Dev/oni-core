import { describe, it, expect, vi } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";
import type { ONIModel } from "../../models/types.js";

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

function makeDebater(id: string, position: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => ({
    messages: [{ role: "assistant", content: `${id}: ${position} on "${state.task}"` }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

describe("SwarmGraph.debate()", () => {
  it("runs multiple rounds of debate with judge termination", async () => {
    let judgeRound = 0;

    const judgeModel: ONIModel = {
      provider: "test",
      modelId: "judge",
      capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
      chat: vi.fn().mockImplementation(async () => {
        judgeRound++;
        // Consensus on round 2
        return {
          content: judgeRound >= 2 ? "CONSENSUS" : "CONTINUE",
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: "end" as const,
        };
      }),
      async *stream() {},
    };

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [
        makeDebater("optimist", "This is great"),
        makeDebater("pessimist", "This is terrible"),
      ],
      judge: {
        model: judgeModel,
        systemPrompt: "Judge the debate.",
        maxRounds: 5,
        consensusKeyword: "CONSENSUS",
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "Should AI be regulated?" });

    expect(result.done).toBe(true);
    expect(judgeModel.chat).toHaveBeenCalled();
    expect(judgeRound).toBe(2);
  });

  it("terminates at maxRounds if no consensus", async () => {
    const judgeModel: ONIModel = {
      provider: "test",
      modelId: "judge",
      capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
      chat: vi.fn().mockResolvedValue({
        content: "CONTINUE",
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: "end" as const,
      }),
      async *stream() {},
    };

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [
        makeDebater("a", "yes"),
        makeDebater("b", "no"),
      ],
      judge: {
        model: judgeModel,
        maxRounds: 2,
        consensusKeyword: "CONSENSUS",
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "endless debate" });

    expect(result.done).toBe(true);
    // Should have been called exactly maxRounds times
    expect(judgeModel.chat).toHaveBeenCalledTimes(2);
  });
});
