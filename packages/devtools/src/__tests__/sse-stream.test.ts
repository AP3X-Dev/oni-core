import { describe, it, expect, afterEach } from "vitest";
import { startDevtools } from "../server.js";
import { createMockGraph, createMockRegistry, collectSSE } from "./helpers.js";
import type { DevtoolsServer, NodeEvent } from "../types.js";

describe("devtools — /stream SSE", () => {
  let server: DevtoolsServer | undefined;

  afterEach(async () => {
    await server?.stop();
  });

  it("emits node_start and node_end events via SSE", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18920 });

    // Start collecting SSE events for 500ms
    const eventsPromise = collectSSE(`${server.url}/stream`, 500);

    // Give the SSE connection a moment to establish
    await new Promise((r) => setTimeout(r, 100));

    // Emit events
    const now = Date.now();
    server.emit({
      type: "node_start",
      run_id: "run-1",
      node: "llm_call",
      ts: now,
    });

    server.emit({
      type: "node_end",
      run_id: "run-1",
      node: "llm_call",
      ts: now + 100,
      duration_ms: 100,
      state_keys_changed: ["messages"],
    });

    const events = await eventsPromise;

    const nodeStarts = events.filter((e) => e.event === "node_start");
    const nodeEnds = events.filter((e) => e.event === "node_end");

    expect(nodeStarts.length).toBeGreaterThanOrEqual(1);
    expect(nodeEnds.length).toBeGreaterThanOrEqual(1);

    const startData = nodeStarts[0].data as NodeEvent;
    expect(startData.node).toBe("llm_call");
    expect(startData.run_id).toBe("run-1");

    const endData = nodeEnds[0].data as NodeEvent;
    expect(endData.node).toBe("llm_call");
    expect(endData.duration_ms).toBe(100);
  });

  it("records emitted events in /runs", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18921 });

    const now = Date.now();
    server.emit({ type: "node_start", run_id: "run-2", node: "tool_executor", ts: now });
    server.emit({ type: "node_end", run_id: "run-2", node: "tool_executor", ts: now + 50, duration_ms: 50 });

    const res = await fetch(`${server.url}/runs`);
    const runs = await res.json() as Array<{ run_id: string; events: unknown[] }>;

    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe("run-2");
    expect(runs[0].events).toHaveLength(2);
  });

  it("evicts oldest runs when maxRuns exceeded", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18922, maxRuns: 3 });

    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      server.emit({ type: "node_start", run_id: `run-${i}`, node: "n", ts: now + i });
    }

    const res = await fetch(`${server.url}/runs`);
    const runs = await res.json() as Array<{ run_id: string }>;

    expect(runs.length).toBeLessThanOrEqual(3);
    // Oldest runs should have been evicted
    const ids = runs.map((r) => r.run_id);
    expect(ids).not.toContain("run-0");
    expect(ids).not.toContain("run-1");
  });
});
