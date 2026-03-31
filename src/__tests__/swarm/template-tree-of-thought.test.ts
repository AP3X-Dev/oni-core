import { describe, it, expect } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";
import type { BranchState } from "../../swarm/types.js";

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

describe("SwarmGraph.treeOfThought()", () => {
  it("expands, scores, prunes, and selects best branch", async () => {
    let thinkCount = 0;
    const thinker = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        thinkCount++;
        return { context: { thought: `Thought-${thinkCount}`, stateDelta: { step: thinkCount } } };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return { id: "thinker", role: "thinker", capabilities: [], skeleton: g.compile() as any };
    })();

    // Even-numbered thoughts get 0.8, odd get 0.3
    const scorer = (branch: BranchState<BaseSwarmState>, _state: BaseSwarmState): number => {
      const thought = branch.thought as string;
      const num = parseInt(thought.replace("Thought-", ""), 10);
      return num % 2 === 0 ? 0.8 : 0.3;
    };

    const swarm = SwarmGraph.treeOfThought<BaseSwarmState>({
      thinker,
      scorer,
      branchFactor: 3,
      maxDepth: 2,
      topK: 2,
      pruneThreshold: 0.2,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "reason about something" });

    expect(result.done).toBe(true);
    const ctx = result.context as Record<string, unknown>;
    expect(ctx.selectedBranch).not.toBeNull();
    const selected = ctx.selectedBranch as BranchState<BaseSwarmState>;
    expect(selected.score).toBeGreaterThan(0);
    expect(ctx.currentDepth).toBe(2);
  });

  it("terminates early when zero branches survive pruning", async () => {
    const thinker = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        return { context: { thought: "low-thought", stateDelta: {} } };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return { id: "thinker", role: "thinker", capabilities: [], skeleton: g.compile() as any };
    })();

    // Scorer always returns 0.05 — below pruneThreshold of 0.5
    const scorer = (_branch: BranchState<BaseSwarmState>, _state: BaseSwarmState): number => 0.05;

    const swarm = SwarmGraph.treeOfThought<BaseSwarmState>({
      thinker,
      scorer,
      branchFactor: 2,
      maxDepth: 3,
      topK: 5,
      pruneThreshold: 0.5,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "always-failing reasoning" });

    expect(result.done).toBe(true);
    const ctx = result.context as Record<string, unknown>;
    // Should have terminated early after depth 1 (all pruned)
    expect(ctx.currentDepth).toBe(1);
    expect(ctx.selectedBranch).toBeNull();
  });

  it("topK limits surviving branches", async () => {
    let expandCalls = 0;
    const thinker = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        expandCalls++;
        return { context: { thought: `Thought-${expandCalls}`, stateDelta: {} } };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return { id: "thinker", role: "thinker", capabilities: [], skeleton: g.compile() as any };
    })();

    // All branches score 0.9 — nothing pruned by threshold
    const scorer = (_branch: BranchState<BaseSwarmState>, _state: BaseSwarmState): number => 0.9;

    const swarm = SwarmGraph.treeOfThought<BaseSwarmState>({
      thinker,
      scorer,
      branchFactor: 5,
      maxDepth: 2,
      topK: 2,
      pruneThreshold: 0.1,
    });

    const app = swarm.compile();
    await app.invoke({ task: "topK limiting" });

    // depth 0: 1 root × 5 = 5 calls
    // depth 1: 2 survivors × 5 = 10 calls
    // total = 15
    expect(expandCalls).toBe(15);
  });
});
