import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, appendList } from "../index.js";

/**
 * Regression test for BUG-0367:
 *
 * A working-tree change to src/pregel/streaming.ts introduced a reference to
 * an undefined variable `nodesSnapshot` (replacing `ctx.nodes.has(name)` at
 * line 182 and `ctx.nodes.get(name)` at line 207). This caused a
 * `ReferenceError: nodesSnapshot is not defined` on every graph invocation,
 * producing 100% test-suite failure.
 *
 * These tests verify that:
 *  1. invoke() on a single-node graph succeeds without ReferenceError.
 *  2. stream() also iterates without crashing — the ReferenceError was thrown
 *     inside the async generator that backs both invoke() and stream().
 *  3. Parallel node execution (the specific code path that used nodesSnapshot)
 *     completes successfully when multiple nodes run in the same superstep.
 */

describe("BUG-0367: streamSupersteps does not reference undefined nodesSnapshot", () => {
  it("invoke() on a basic single-node graph completes without ReferenceError", async () => {
    type S = { value: number };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => 0) } });
    g.addNode("increment", (s) => ({ value: s.value + 1 }));
    g.addEdge(START, "increment");
    g.addEdge("increment", END);
    const app = g.compile();

    // If nodesSnapshot is undefined this throws ReferenceError before any assertion
    const result = await app.invoke({ value: 10 });
    expect(result.value).toBe(11);
  });

  it("stream() iterates through events without ReferenceError", async () => {
    type S = { label: string };
    const g = new StateGraph<S>({ channels: { label: lastValue(() => "") } });
    g.addNode("tag", () => ({ label: "tagged" }));
    g.addEdge(START, "tag");
    g.addEdge("tag", END);
    const app = g.compile();

    const events: unknown[] = [];
    // stream() uses the same streamSupersteps generator that would throw
    for await (const event of app.stream({ label: "" })) {
      events.push(event);
    }

    // At minimum we expect a state update event — the exact structure varies
    // by stream mode, but any successful iteration proves the fix holds.
    expect(events.length).toBeGreaterThan(0);
  });

  it("parallel node execution succeeds when multiple nodes share a superstep", async () => {
    // This exercises the parallel execution path inside streamSupersteps that
    // maps over executableNodes and calls ctx.nodes.get(name) — the exact line
    // that was replaced with the broken nodesSnapshot.get(name) reference.
    type S = { results: string[] };
    const g = new StateGraph<S>({
      channels: { results: appendList(() => [] as string[]) },
    });

    g.addNode("branch-a", () => ({ results: ["a"] }));
    g.addNode("branch-b", () => ({ results: ["b"] }));
    g.addNode("merge",    () => ({ results: ["merged"] }));

    // START → branch-a AND branch-b in parallel → merge → END
    g.addEdge(START, "branch-a");
    g.addEdge(START, "branch-b");
    g.addEdge("branch-a", "merge");
    g.addEdge("branch-b", "merge");
    g.addEdge("merge", END);
    const app = g.compile();

    // Would throw ReferenceError inside the Promise.allSettled map callback
    // if nodesSnapshot was used instead of ctx.nodes
    const result = await app.invoke({ results: [] });
    expect(result.results).toContain("merged");
  });

  it("multi-step graph traversal (multiple supersteps) completes without error", async () => {
    type S = { step: number };
    const g = new StateGraph<S>({ channels: { step: lastValue(() => 0) } });
    g.addNode("s1", () => ({ step: 1 }));
    g.addNode("s2", (s) => ({ step: s.step + 1 }));
    g.addNode("s3", (s) => ({ step: s.step + 1 }));
    g.addEdge(START, "s1");
    g.addEdge("s1", "s2");
    g.addEdge("s2", "s3");
    g.addEdge("s3", END);
    const app = g.compile();

    const result = await app.invoke({ step: 0 });
    expect(result.step).toBe(3);
  });
});
