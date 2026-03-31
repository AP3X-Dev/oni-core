import { describe, it, expect, vi } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";
import type { VerificationResult } from "../../swarm/types.js";

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

function makeWorker(id: string, outputKey: string, outputValue: unknown) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => ({
    context: { ...(state.context ?? {}), [outputKey]: outputValue },
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [],
    skeleton: g.compile() as any,
  };
}

describe("SwarmGraph.stepwiseVerify()", () => {
  it("all stages pass on first try", async () => {
    const worker1 = makeWorker("worker1", "step1", "result1");
    const worker2 = makeWorker("worker2", "step2", "result2");

    const swarm = SwarmGraph.stepwiseVerify<BaseSwarmState>({
      stages: [
        {
          worker: worker1,
          verifier: async (_result, _state): Promise<VerificationResult> => ({
            passed: true,
            feedback: "ok",
          }),
          maxRetries: 0,
        },
        {
          worker: worker2,
          verifier: async (_result, _state): Promise<VerificationResult> => ({
            passed: true,
            feedback: "ok",
          }),
          maxRetries: 0,
        },
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "run two stages" });

    expect(result.done).toBe(true);
    const stageResults = result.context.stageResults as Array<{ status: string }>;
    expect(stageResults).toHaveLength(2);
    expect(stageResults[0].status).toBe("passed");
    expect(stageResults[1].status).toBe("passed");
  });

  it("retries a failing stage then passes", async () => {
    let workerCallCount = 0;
    let verifierCallCount = 0;

    const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
    g.addNode("work", async (state) => {
      workerCallCount++;
      return { context: { ...(state.context ?? {}), attempt: workerCallCount } };
    });
    g.addEdge(START, "work");
    g.addEdge("work", END);

    const worker = {
      id: "retry-worker",
      role: "retry-worker",
      capabilities: [],
      skeleton: g.compile() as any,
    };

    const swarm = SwarmGraph.stepwiseVerify<BaseSwarmState>({
      stages: [
        {
          worker,
          verifier: async (_result, _state): Promise<VerificationResult> => {
            verifierCallCount++;
            // fail first call, pass second
            return {
              passed: verifierCallCount >= 2,
              feedback: verifierCallCount >= 2 ? "ok" : "not yet",
            };
          },
          maxRetries: 2,
        },
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "retry until pass" });

    expect(result.done).toBe(true);
    expect(workerCallCount).toBe(2);
    const stageResults = result.context.stageResults as Array<{ status: string; attempts: number }>;
    expect(stageResults[0].status).toBe("passed");
    expect(stageResults[0].attempts).toBe(2);
  });

  it("halt mode stops on exhausted retries", async () => {
    const worker = makeWorker("halt-worker", "out", "val");

    const swarm = SwarmGraph.stepwiseVerify<BaseSwarmState>({
      stages: [
        {
          worker,
          verifier: async (_result, _state): Promise<VerificationResult> => ({
            passed: false,
            feedback: "always fails",
          }),
          maxRetries: 2,
        },
      ],
      onStageFailure: "halt",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "will fail" });

    expect(result.done).toBe(true);
    const failedStage = result.context.failedStage as { stageIndex: number; reason: string } | null;
    expect(failedStage).not.toBeNull();
    expect(failedStage!.stageIndex).toBe(0);
    const stageResults = result.context.stageResults as Array<{ status: string }>;
    expect(stageResults[0].status).toBe("failed");
  });

  it("skip mode advances past failed stage", async () => {
    const worker1 = makeWorker("skip-worker1", "step1", "v1");
    const worker2 = makeWorker("skip-worker2", "step2", "v2");

    const swarm = SwarmGraph.stepwiseVerify<BaseSwarmState>({
      stages: [
        {
          worker: worker1,
          verifier: async (_result, _state): Promise<VerificationResult> => ({
            passed: false,
            feedback: "first always fails",
          }),
          maxRetries: 1,
        },
        {
          worker: worker2,
          verifier: async (_result, _state): Promise<VerificationResult> => ({
            passed: true,
            feedback: "second always passes",
          }),
          maxRetries: 0,
        },
      ],
      onStageFailure: "skip",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "skip first, pass second" });

    expect(result.done).toBe(true);
    const stageResults = result.context.stageResults as Array<{ status: string }>;
    expect(stageResults).toHaveLength(2);
    expect(stageResults[0].status).toBe("skipped");
    expect(stageResults[1].status).toBe("passed");
    // In skip mode, no failedStage should be set
    expect(result.context.failedStage).toBeNull();
  });
});
