import { describe, it, expect } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";

type PoolState = BaseSwarmState & { items: string[]; summary: string };

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
    items: lastValue(() => [] as string[]),
    summary: lastValue(() => ""),
  };
}

function makeWorker(id: string) {
  const g = new StateGraph<PoolState>({ channels: makeChannels() as any });
  g.addNode("work", async (state) => ({
    messages: [{ role: "assistant", content: `Processed: ${state.task}` }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: "worker",
    capabilities: [],
    skeleton: g.compile() as any,
  };
}

describe("SwarmGraph.pool()", () => {
  it("distributes N tasks across poolSize agents and reduces results", async () => {
    const processed: string[] = [];

    const makeTrackedWorker = (id: string) => {
      const g = new StateGraph<PoolState>({ channels: makeChannels() as any });
      g.addNode("work", async (state) => {
        processed.push(`${id}:${state.task}`);
        return {
          messages: [{ role: "assistant", content: `${id} processed: ${state.task}` }],
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id,
        role: "worker",
        capabilities: [],
        skeleton: g.compile() as any,
        maxConcurrency: 2,
      };
    };

    const template = makeTrackedWorker("worker_template");

    const swarm = SwarmGraph.pool<PoolState>({
      agent: template,
      poolSize: 3,
      inputField: "items",
      reducer: (results) => ({
        summary: `Processed ${Object.keys(results).length} items`,
        done: true,
      }),
      channels: makeChannels() as any,
    });

    const app = swarm.compile();
    const result = await app.invoke({
      task: "batch process",
      items: ["item1", "item2", "item3", "item4", "item5"],
    });

    expect(result.done).toBe(true);
    expect(result.summary).toContain("Processed");
    // All 5 items should have been processed
    expect(processed.length).toBe(5);
  });

  it("limits concurrency to maxConcurrency agents running simultaneously", async () => {
    let peakConcurrency = 0;
    let currentConcurrency = 0;

    const makeSlowWorker = (id: string) => {
      const g = new StateGraph<PoolState>({ channels: makeChannels() as any });
      g.addNode("work", async (state) => {
        currentConcurrency++;
        peakConcurrency = Math.max(peakConcurrency, currentConcurrency);
        // Simulate work
        await new Promise((r) => setTimeout(r, 50));
        currentConcurrency--;
        return {
          messages: [{ role: "assistant", content: `Done: ${state.task}` }],
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id,
        role: "worker",
        capabilities: [],
        skeleton: g.compile() as any,
        maxConcurrency: 1,
      };
    };

    const template = makeSlowWorker("worker_template");

    const swarm = SwarmGraph.pool<PoolState>({
      agent: template,
      poolSize: 2,        // 2 pool slots
      inputField: "items",
      reducer: (_results) => ({
        summary: `Done`,
        done: true,
      }),
      channels: makeChannels() as any,
    });

    const app = swarm.compile();
    await app.invoke({
      task: "concurrency test",
      items: ["a", "b", "c", "d"],
    });

    // With poolSize=2, at most 2 agents should run simultaneously
    expect(peakConcurrency).toBeLessThanOrEqual(2);
    expect(peakConcurrency).toBeGreaterThanOrEqual(1);
  });

  it("handles partial failures — reducer gets error markers for failed tasks", async () => {
    let _callCount = 0;

    const makeFlakyWorker = (id: string) => {
      const g = new StateGraph<PoolState>({ channels: makeChannels() as any });
      g.addNode("work", async (state) => {
        _callCount++;
        if (state.task === "bad_item") {
          throw new Error("Worker crashed on bad item");
        }
        return {
          messages: [{ role: "assistant", content: `OK: ${state.task}` }],
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id,
        role: "worker",
        capabilities: [],
        skeleton: g.compile() as any,
        maxRetries: 0,  // fail fast
        maxConcurrency: 1,
      };
    };

    const template = makeFlakyWorker("worker_template");

    let reducerResults: Record<string, unknown> | undefined;
    const swarm = SwarmGraph.pool<PoolState>({
      agent: template,
      poolSize: 2,
      inputField: "items",
      reducer: (results) => {
        reducerResults = results;
        const errors = Object.values(results).filter(
          (r) => r && typeof r === "object" && (r as any)._error
        );
        return {
          summary: `${Object.keys(results).length} results, ${errors.length} errors`,
          done: true,
        };
      },
      channels: makeChannels() as any,
    });

    const app = swarm.compile();
    const result = await app.invoke({
      task: "error test",
      items: ["good1", "bad_item", "good2"],
    });

    // Reducer should have run with partial results
    expect(result.done).toBe(true);
    expect(reducerResults).toBeDefined();

    // Should have error markers for the bad item
    const errorEntries = Object.values(reducerResults!).filter(
      (r) => r && typeof r === "object" && (r as any)._error
    );
    expect(errorEntries.length).toBe(1);
  });

  it("handles empty input array gracefully", async () => {
    const swarm = SwarmGraph.pool<PoolState>({
      agent: makeWorker("worker_template"),
      poolSize: 2,
      inputField: "items",
      reducer: (results) => ({
        summary: `Processed ${Object.keys(results).length} items`,
        done: true,
      }),
      channels: makeChannels() as any,
    });

    const app = swarm.compile();
    const result = await app.invoke({
      task: "empty test",
      items: [],
    });

    // Should still reach the reducer and complete
    expect(result.done).toBe(true);
    expect(result.summary).toContain("Processed 0");
  });

  it("pool strategy distributes work across pool agents", async () => {
    const workerInvocations: string[] = [];

    const makeTracked = (id: string) => {
      const g = new StateGraph<PoolState>({ channels: makeChannels() as any });
      g.addNode("work", async (state) => {
        workerInvocations.push(id);
        return {
          messages: [{ role: "assistant", content: `${id}: ${state.task}` }],
        };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id,
        role: "worker",
        capabilities: [],
        skeleton: g.compile() as any,
        maxConcurrency: 1,
      };
    };

    const template = makeTracked("worker_template");

    const swarm = SwarmGraph.pool<PoolState>({
      agent: template,
      poolSize: 3,
      inputField: "items",
      reducer: (results) => ({
        summary: `Done: ${Object.keys(results).length}`,
        done: true,
      }),
      channels: makeChannels() as any,
    });

    const app = swarm.compile();
    await app.invoke({
      task: "distribution test",
      items: ["a", "b", "c", "d", "e", "f"],
    });

    // 6 items should be distributed across 3 pool agents
    expect(workerInvocations.length).toBe(6);
  });
});
