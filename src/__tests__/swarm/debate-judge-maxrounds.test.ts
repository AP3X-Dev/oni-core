// Regression test for BUG-0272
// The debate judge termination condition used `nextRound >= config.judge.maxRounds`
// instead of `nextRound > config.judge.maxRounds`.
// With maxRounds: 2, after the second judge invocation (round=1), nextRound=2.
// The >= condition fired: 2 >= 2 → true, so the graph stopped after only 1 real
// evaluation cycle (the judge's chat() was called only 1 time, not 2).
// Fix: changed to nextRound > maxRounds so the judge runs exactly maxRounds cycles
// before the graph terminates.

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

function makeDebater(id: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => ({
    agentResults: { [id]: `${id} says: ${state.task}` },
    messages: [{ role: "assistant" as const, content: `${id} argues` }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

function makeJudgeModel(alwaysRespond: string) {
  const model: ONIModel = {
    provider: "test",
    modelId: "judge",
    capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
    chat: vi.fn().mockResolvedValue({
      content: alwaysRespond,
      usage: { inputTokens: 5, outputTokens: 3 },
      stopReason: "end" as const,
    }),
    async *stream() {},
  };
  return model;
}

describe("BUG-0272: debate judge terminates after exactly maxRounds evaluation cycles", () => {
  it("BUG-0272: judge.chat is called exactly maxRounds times when no consensus", async () => {
    const judgeModel = makeJudgeModel("CONTINUE");

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [makeDebater("pro"), makeDebater("con")],
      judge: {
        model: judgeModel,
        maxRounds: 2,
        consensusKeyword: "CONSENSUS",
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test debate" });

    expect(result.done).toBe(true);
    // BUG: with >= the judge was only called 1 time (off by one)
    // Fix: with >  the judge is called exactly maxRounds times
    expect(judgeModel.chat).toHaveBeenCalledTimes(2);
  });

  it("BUG-0272: with maxRounds: 3, judge is called exactly 3 times", async () => {
    const judgeModel = makeJudgeModel("CONTINUE");

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [makeDebater("a"), makeDebater("b")],
      judge: {
        model: judgeModel,
        maxRounds: 3,
        consensusKeyword: "CONSENSUS",
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "debate forever" });

    expect(result.done).toBe(true);
    expect(judgeModel.chat).toHaveBeenCalledTimes(3);
  });

  it("BUG-0272: with maxRounds: 1, judge is called exactly 1 time", async () => {
    const judgeModel = makeJudgeModel("CONTINUE");

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [makeDebater("x"), makeDebater("y")],
      judge: {
        model: judgeModel,
        maxRounds: 1,
        consensusKeyword: "CONSENSUS",
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "single round" });

    expect(result.done).toBe(true);
    expect(judgeModel.chat).toHaveBeenCalledTimes(1);
  });

  it("BUG-0272: consensus before maxRounds still terminates early", async () => {
    let callCount = 0;
    const judgeModel: ONIModel = {
      provider: "test",
      modelId: "judge",
      capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
      chat: vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          content: callCount >= 2 ? "CONSENSUS" : "CONTINUE",
          usage: { inputTokens: 5, outputTokens: 3 },
          stopReason: "end" as const,
        };
      }),
      async *stream() {},
    };

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [makeDebater("p"), makeDebater("q")],
      judge: {
        model: judgeModel,
        maxRounds: 10,
        consensusKeyword: "CONSENSUS",
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "reaches consensus" });

    expect(result.done).toBe(true);
    // Consensus after 2 rounds — should not run all 10
    expect(judgeModel.chat).toHaveBeenCalledTimes(2);
  });
});
