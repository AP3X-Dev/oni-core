#!/usr/bin/env node
// ============================================================
// @oni.bot/core — Performance Benchmarks
// ============================================================

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  StateGraph, START, END,
  lastValue, appendList, mergeObject,
  MemoryCheckpointer,
  InMemoryStore,
  SwarmGraph,
  baseSwarmChannels,
} from "../src/index.js";

import type { BaseSwarmState, SwarmAgentDef } from "../src/swarm/index.js";

// ============================================================
// Types
// ============================================================

interface BenchmarkResult {
  name: string;
  ops: number;        // operations per second
  avgMs: number;       // average ms per operation
  runs: number;        // number of runs
}

// ============================================================
// Bench harness
// ============================================================

async function bench(
  name: string,
  fn: () => Promise<void> | void,
  runs = 100,
): Promise<BenchmarkResult> {
  // Warmup — 5 iterations
  for (let i = 0; i < 5; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < runs; i++) await fn();
  const elapsed = performance.now() - start;

  return {
    name,
    ops: Math.round((runs / elapsed) * 1000),
    avgMs: Math.round((elapsed / runs) * 100) / 100,
    runs,
  };
}

// ============================================================
// Helpers
// ============================================================

type SimpleState = { value: number };

function createLinearGraph(nodeCount: number) {
  const g = new StateGraph<SimpleState>({
    channels: { value: lastValue(() => 0) },
  });

  for (let i = 0; i < nodeCount; i++) {
    g.addNode(`node_${i}`, async (s) => ({ value: s.value + 1 }));
  }

  g.addEdge(START, "node_0");
  for (let i = 0; i < nodeCount - 1; i++) {
    g.addEdge(`node_${i}`, `node_${i + 1}`);
  }
  g.addEdge(`node_${nodeCount - 1}`, END);

  return g.compile();
}

// ============================================================
// 1. Graph invoke latency
// ============================================================

async function benchGraphInvoke(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const n of [1, 5, 10, 20]) {
    const skeleton = createLinearGraph(n);
    const runs = n <= 10 ? 500 : 200;
    results.push(
      await bench(`invoke: ${n} node${n > 1 ? "s" : ""}`, async () => {
        await skeleton.invoke({ value: 0 });
      }, runs),
    );
  }

  return results;
}

// ============================================================
// 2. Stream throughput
// ============================================================

async function benchStreamThroughput(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const n of [5, 10]) {
    const skeleton = createLinearGraph(n);
    results.push(
      await bench(`stream: ${n} nodes (events)`, async () => {
        let count = 0;
        for await (const _evt of skeleton.stream({ value: 0 })) {
          count++;
        }
      }, 500),
    );
  }

  return results;
}

// ============================================================
// 3. Channel reducer performance
// ============================================================

async function benchReducers(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const UPDATES = 1000;

  // lastValue
  results.push(
    await bench(`reducer: lastValue (${UPDATES}x)`, () => {
      const ch = lastValue(() => 0);
      let val = ch.default();
      for (let i = 0; i < UPDATES; i++) {
        val = ch.reducer(val, i);
      }
    }, 500),
  );

  // appendList
  results.push(
    await bench(`reducer: appendList (${UPDATES}x)`, () => {
      const ch = appendList<number>(() => []);
      let val = ch.default();
      for (let i = 0; i < UPDATES; i++) {
        val = ch.reducer(val, [i]);
      }
    }, 500),
  );

  // mergeObject
  results.push(
    await bench(`reducer: mergeObject (${UPDATES}x)`, () => {
      const ch = mergeObject(() => ({} as Record<string, number>));
      let val = ch.default();
      for (let i = 0; i < UPDATES; i++) {
        val = ch.reducer(val, { [`key_${i}`]: i });
      }
    }, 500),
  );

  return results;
}

// ============================================================
// 4. Checkpoint read/write
// ============================================================

async function benchCheckpoint(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Small state
  const cp = new MemoryCheckpointer<SimpleState>();
  results.push(
    await bench("checkpoint: write (small state)", async () => {
      await cp.put({
        threadId: "bench-thread",
        step: 1,
        state: { value: 42 },
        timestamp: Date.now(),
      });
    }, 500),
  );

  // Pre-populate for reads
  await cp.put({
    threadId: "bench-read",
    step: 1,
    state: { value: 99 },
    timestamp: Date.now(),
  });

  results.push(
    await bench("checkpoint: read (small state)", async () => {
      await cp.get("bench-read");
    }, 500),
  );

  // Large state
  type LargeState = { data: Record<string, unknown> };
  const cpLarge = new MemoryCheckpointer<LargeState>();
  const largeState: LargeState = {
    data: Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`field_${i}`, { nested: { value: i, text: "x".repeat(100) } }]),
    ),
  };

  results.push(
    await bench("checkpoint: write (large state)", async () => {
      await cpLarge.put({
        threadId: "bench-large",
        step: 1,
        state: largeState,
        timestamp: Date.now(),
      });
    }, 500),
  );

  await cpLarge.put({
    threadId: "bench-large-read",
    step: 1,
    state: largeState,
    timestamp: Date.now(),
  });

  results.push(
    await bench("checkpoint: read (large state)", async () => {
      await cpLarge.get("bench-large-read");
    }, 500),
  );

  return results;
}

// ============================================================
// 5. Store operations
// ============================================================

async function benchStore(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // put — 100 items
  results.push(
    await bench("store: put (100 items)", async () => {
      const store = new InMemoryStore();
      for (let i = 0; i < 100; i++) {
        await store.put(["bench"], `key_${i}`, { index: i, data: "x".repeat(50) });
      }
    }, 200),
  );

  // get — from 1000 items
  const preloaded = new InMemoryStore();
  for (let i = 0; i < 1000; i++) {
    await preloaded.put(["bench"], `key_${i}`, { index: i, data: "x".repeat(50) });
  }

  results.push(
    await bench("store: get (from 1000 items)", async () => {
      await preloaded.get(["bench"], "key_500");
    }, 500),
  );

  // list — 100 items
  const listStore = new InMemoryStore();
  for (let i = 0; i < 100; i++) {
    await listStore.put(["bench"], `key_${i}`, { index: i });
  }

  results.push(
    await bench("store: list (100 items)", async () => {
      await listStore.list(["bench"]);
    }, 200),
  );

  // search — substring match over 100 items
  const searchStore = new InMemoryStore();
  for (let i = 0; i < 100; i++) {
    await searchStore.put(["bench"], `key_${i}`, { text: `item number ${i} with some content` });
  }

  results.push(
    await bench("store: search (100 items)", async () => {
      await searchStore.search(["bench"], "number 42");
    }, 200),
  );

  return results;
}

// ============================================================
// 6. Swarm template overhead
// ============================================================

function makeAgentSkeleton<S extends BaseSwarmState>(id: string) {
  const g = new StateGraph<S>({
    channels: {
      ...baseSwarmChannels,
    } as any,
  });
  g.addNode("worker", async (state: S) => ({
    agentResults: { [id]: `done-${id}` },
  } as Partial<S>));
  g.addEdge(START, "worker");
  g.addEdge("worker", END);
  return g.compile();
}

function makeAgent<S extends BaseSwarmState>(id: string): SwarmAgentDef<S> {
  return {
    id,
    role: id,
    capabilities: [{ name: "test", description: "test" }],
    skeleton: makeAgentSkeleton<S>(id),
  } as SwarmAgentDef<S>;
}

async function benchSwarmTemplates(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Suppress swarm console.log noise during benchmarks
  const origLog = console.log;
  console.log = () => {};

  // Hierarchical: compile + invoke
  results.push(
    await bench("swarm: hierarchical compile", () => {
      const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
        supervisor: { strategy: "round-robin", maxRounds: 1 },
        agents: [makeAgent("a1"), makeAgent("a2"), makeAgent("a3")],
      });
      swarm.compile();
    }, 200),
  );

  const hierSkeleton = SwarmGraph.hierarchical<BaseSwarmState>({
    supervisor: { strategy: "round-robin", maxRounds: 1 },
    agents: [makeAgent("a1"), makeAgent("a2"), makeAgent("a3")],
  }).compile();

  results.push(
    await bench("swarm: hierarchical invoke", async () => {
      await hierSkeleton.invoke({ task: "test" } as Partial<BaseSwarmState>);
    }, 100),
  );

  // FanOut: compile + invoke
  results.push(
    await bench("swarm: fanOut compile", () => {
      const swarm = SwarmGraph.fanOut<BaseSwarmState>({
        agents: [makeAgent("w1"), makeAgent("w2"), makeAgent("w3")],
        reducer: (res) => ({ agentResults: res }),
      });
      swarm.compile();
    }, 200),
  );

  const fanSkeleton = SwarmGraph.fanOut<BaseSwarmState>({
    agents: [makeAgent("w1"), makeAgent("w2"), makeAgent("w3")],
    reducer: (res) => ({ agentResults: res }),
  }).compile();

  results.push(
    await bench("swarm: fanOut invoke", async () => {
      await fanSkeleton.invoke({ task: "test" } as Partial<BaseSwarmState>);
    }, 100),
  );

  // Pipeline: compile + invoke
  results.push(
    await bench("swarm: pipeline compile", () => {
      const swarm = SwarmGraph.pipeline<BaseSwarmState>({
        stages: [makeAgent("s1"), makeAgent("s2"), makeAgent("s3")],
      });
      swarm.compile();
    }, 200),
  );

  const pipeSkeleton = SwarmGraph.pipeline<BaseSwarmState>({
    stages: [makeAgent("s1"), makeAgent("s2"), makeAgent("s3")],
  }).compile();

  results.push(
    await bench("swarm: pipeline invoke", async () => {
      await pipeSkeleton.invoke({ task: "test" } as Partial<BaseSwarmState>);
    }, 100),
  );

  // Restore console.log
  console.log = origLog;

  return results;
}

// ============================================================
// Runner
// ============================================================

function formatTable(results: BenchmarkResult[]): string {
  const nameWidth = Math.max(36, ...results.map((r) => r.name.length));
  const header = `| ${"Benchmark".padEnd(nameWidth)} | ops/sec | avg (ms) | runs |`;
  const sep    = `|${"-".repeat(nameWidth + 2)}|---------|----------|------|`;

  const rows = results.map((r) => {
    const name = r.name.padEnd(nameWidth);
    const ops  = String(r.ops).padStart(7);
    const avg  = r.avgMs.toFixed(2).padStart(8);
    const runs = String(r.runs).padStart(4);
    return `| ${name} | ${ops} | ${avg} | ${runs} |`;
  });

  return [header, sep, ...rows].join("\n");
}

async function main() {
  console.log("");
  console.log("@oni.bot/core v0.7.0 — Performance Benchmarks");
  console.log("=".repeat(50));
  console.log("");

  const allResults: BenchmarkResult[] = [];

  // 1. Graph invoke latency
  process.stdout.write("Running graph invoke benchmarks...");
  const invokeResults = await benchGraphInvoke();
  allResults.push(...invokeResults);
  console.log(" done");

  // 2. Stream throughput
  process.stdout.write("Running stream throughput benchmarks...");
  const streamResults = await benchStreamThroughput();
  allResults.push(...streamResults);
  console.log(" done");

  // 3. Channel reducers
  process.stdout.write("Running reducer benchmarks...");
  const reducerResults = await benchReducers();
  allResults.push(...reducerResults);
  console.log(" done");

  // 4. Checkpoint
  process.stdout.write("Running checkpoint benchmarks...");
  const cpResults = await benchCheckpoint();
  allResults.push(...cpResults);
  console.log(" done");

  // 5. Store
  process.stdout.write("Running store benchmarks...");
  const storeResults = await benchStore();
  allResults.push(...storeResults);
  console.log(" done");

  // 6. Swarm templates
  process.stdout.write("Running swarm template benchmarks...");
  const swarmResults = await benchSwarmTemplates();
  allResults.push(...swarmResults);
  console.log(" done");

  // Print markdown table
  console.log("");
  console.log(formatTable(allResults));
  console.log("");

  // Write JSON results
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = join(__dirname, "results.json");
  const jsonPayload = {
    timestamp: new Date().toISOString(),
    version: "0.7.0",
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    results: allResults,
  };
  writeFileSync(outPath, JSON.stringify(jsonPayload, null, 2) + "\n");
  console.log(`Results written to ${outPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
