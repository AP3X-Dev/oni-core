import { describe, it, expect } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";
import type { SprintResult } from "../../swarm/types.js";

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

describe("SwarmGraph.adversarialDev()", () => {
  it("sprint passes when evaluator score meets threshold", async () => {
    const completedSprints: SprintResult[] = [];

    const planner = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        const sprints = ((state.context as any)?.sprints ?? []) as any[];
        if (sprints.length >= 1) return { context: { plannerDone: true } };
        return { context: { sprintDescription: "Build login", suggestedCriteria: ["Works"], constraints: [] } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "planner", role: "planner", capabilities: [], skeleton: g.compile() as any };
    })();

    const generator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        return { context: { generatorOutput: "login-module-v1" } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "generator", role: "generator", capabilities: [], skeleton: g.compile() as any };
    })();

    const evaluator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        return { context: { score: 8, feedback: "Looks good" } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "evaluator", role: "evaluator", capabilities: [], skeleton: g.compile() as any };
    })();

    const swarm = SwarmGraph.adversarialDev<BaseSwarmState>({
      planner,
      generator,
      evaluator,
      passThreshold: 7,
      maxSprints: 5,
      maxRetriesPerSprint: 3,
      contractNegotiationRounds: 1,
      onSprintComplete: async (sprint) => {
        completedSprints.push(sprint);
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "build auth" });

    expect(result.done).toBe(true);
    const ctx = result.context as Record<string, unknown>;
    const sprints = ctx.sprints as SprintResult[];

    expect(sprints).toHaveLength(1);
    expect(sprints[0]!.passed).toBe(true);
    expect(sprints[0]!.finalScore).toBe(8);
    expect(completedSprints).toHaveLength(1);
    expect(ctx.plannerDone).toBe(true);
  });

  it("retries on failure, then fails sprint at maxRetries", async () => {
    let evaluatorCallCount = 0;

    const planner = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        const sprints = ((state.context as any)?.sprints ?? []) as any[];
        if (sprints.length >= 1) return { context: { plannerDone: true } };
        return { context: { sprintDescription: "Build API", suggestedCriteria: ["Fast"], constraints: [] } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "planner", role: "planner", capabilities: [], skeleton: g.compile() as any };
    })();

    const generator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        return { context: { generatorOutput: "api-v1" } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "generator", role: "generator", capabilities: [], skeleton: g.compile() as any };
    })();

    const evaluator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        evaluatorCallCount++;
        return { context: { score: 3, feedback: "Not good enough" } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "evaluator", role: "evaluator", capabilities: [], skeleton: g.compile() as any };
    })();

    const swarm = SwarmGraph.adversarialDev<BaseSwarmState>({
      planner,
      generator,
      evaluator,
      passThreshold: 7,
      maxSprints: 5,
      maxRetriesPerSprint: 2,
      contractNegotiationRounds: 0,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "build api" });

    expect(result.done).toBe(true);
    const ctx = result.context as Record<string, unknown>;
    const sprints = ctx.sprints as SprintResult[];

    // 1 sprint, maxRetriesPerSprint=2 means 3 attempts total (0,1,2)
    expect(evaluatorCallCount).toBe(3);
    expect(sprints).toHaveLength(1);
    expect(sprints[0]!.passed).toBe(false);
    expect(sprints[0]!.attempts).toHaveLength(3);
  });

  it("terminates at maxSprints", async () => {
    const planner = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        // Never sets plannerDone
        return { context: { sprintDescription: "Sprint", suggestedCriteria: ["Done"], constraints: [] } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "planner", role: "planner", capabilities: [], skeleton: g.compile() as any };
    })();

    const generator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        return { context: { generatorOutput: "output" } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "generator", role: "generator", capabilities: [], skeleton: g.compile() as any };
    })();

    const evaluator = (() => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async () => {
        return { context: { score: 9, feedback: "Excellent" } };
      });
      g.addEdge(START, "work"); g.addEdge("work", END);
      return { id: "evaluator", role: "evaluator", capabilities: [], skeleton: g.compile() as any };
    })();

    const swarm = SwarmGraph.adversarialDev<BaseSwarmState>({
      planner,
      generator,
      evaluator,
      passThreshold: 7,
      maxSprints: 3,
      maxRetriesPerSprint: 2,
      contractNegotiationRounds: 0,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "unlimited sprints" });

    expect(result.done).toBe(true);
    const ctx = result.context as Record<string, unknown>;
    const sprints = ctx.sprints as SprintResult[];

    expect(sprints).toHaveLength(3);
    for (const sprint of sprints) {
      expect(sprint.passed).toBe(true);
    }
  });
});
