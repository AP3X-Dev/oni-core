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

function makeJudgeModel(responses: Array<{ content: string }>): ONIModel {
  let callIdx = 0;
  return {
    provider: "test",
    modelId: "judge",
    capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
    chat: vi.fn().mockImplementation(async () => {
      const resp = responses[callIdx] ?? responses[responses.length - 1]!;
      callIdx++;
      return {
        ...resp,
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: "end" as const,
      };
    }),
    async *stream() {},
  };
}

describe("Debate scoring & consensus threshold", () => {
  it("accumulates per-round scores in context.debateScores", async () => {
    const judgeModel = makeJudgeModel([
      // Round 1: scores but no consensus
      { content: JSON.stringify({ scores: { alice: 7, bob: 5 }, verdict: "CONTINUE" }) },
      // Round 2: consensus
      { content: JSON.stringify({ scores: { alice: 8, bob: 7 }, verdict: "CONSENSUS" }) },
    ]);

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [
        makeDebater("alice", "Pro regulation"),
        makeDebater("bob", "Anti regulation"),
      ],
      judge: {
        model: judgeModel,
        maxRounds: 5,
        scoreDebaters: true,
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "AI regulation" });

    expect(result.done).toBe(true);
    // Scores should be accumulated in context
    const scores = (result.context as Record<string, unknown>).debateScores as Array<{
      round: number;
      scores: Record<string, number>;
    }>;
    expect(scores).toBeDefined();
    expect(scores.length).toBe(2);
    expect(scores[0]!.scores).toEqual({ alice: 7, bob: 5 });
    expect(scores[1]!.scores).toEqual({ alice: 8, bob: 7 });
  });

  it("ends debate early when scores converge within consensusThreshold", async () => {
    const judgeModel = makeJudgeModel([
      // Round 1: scores spread = 3 (above threshold of 2)
      { content: JSON.stringify({ scores: { alice: 8, bob: 5 }, verdict: "CONTINUE" }) },
      // Round 2: scores spread = 1 (within threshold of 2) → auto-consensus
      { content: JSON.stringify({ scores: { alice: 7, bob: 6 }, verdict: "CONTINUE" }) },
    ]);

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [
        makeDebater("alice", "Pro"),
        makeDebater("bob", "Con"),
      ],
      judge: {
        model: judgeModel,
        maxRounds: 10,
        scoreDebaters: true,
        consensusThreshold: 2,
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "threshold test" });

    expect(result.done).toBe(true);
    // Should have stopped at round 2 due to threshold, not round 10
    expect(judgeModel.chat).toHaveBeenCalledTimes(2);
  });

  it("falls back to keyword detection when score JSON is invalid", async () => {
    const judgeModel = makeJudgeModel([
      // Round 1: invalid JSON, but has CONTINUE keyword
      { content: "The debate should CONTINUE, both sides have merit." },
      // Round 2: invalid JSON, but has CONSENSUS keyword
      { content: "After careful review, CONSENSUS has been reached." },
    ]);

    const swarm = SwarmGraph.debate<BaseSwarmState>({
      debaters: [
        makeDebater("alice", "Yes"),
        makeDebater("bob", "No"),
      ],
      judge: {
        model: judgeModel,
        maxRounds: 5,
        scoreDebaters: true,
        consensusKeyword: "CONSENSUS",
      },
      topic: "task",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "fallback test" });

    expect(result.done).toBe(true);
    // Should have run 2 rounds (CONTINUE then CONSENSUS)
    expect(judgeModel.chat).toHaveBeenCalledTimes(2);
  });
});
