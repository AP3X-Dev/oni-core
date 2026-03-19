import { describe, it, expect } from "vitest";
import { StateGraph } from "../graph.js";
import { START, END, lastValue } from "../types.js";

describe("Pregel concurrent subgraph invocations — unique invocation keys (BUG-0035)", () => {
  it("BUG-0035: concurrent subgraph invocations do not share _perInvocationParentUpdates keys", async () => {
    // Before the fix: invocationKey was just threadId, so concurrent batch() calls sharing
    // the same threadId would overwrite each other's _perInvocationParentUpdates entry,
    // causing parent updates from one invocation to be lost mid-flight.
    // After the fix: a monotonic counter suffix (threadId::N) ensures each concurrent
    // invocation gets a distinct key, so their update buffers are isolated.

    type ChildState = { value: number };
    const childGraph = new StateGraph<ChildState>({
      channels: { value: lastValue(() => 0) },
    });
    childGraph.addNode("double", (s) => ({ value: s.value * 2 }));
    childGraph.addEdge(START, "double");
    childGraph.addEdge("double", END);
    const childApp = childGraph.compile();

    type ParentState = { a: number; b: number };
    const parentGraph = new StateGraph<ParentState>({
      channels: {
        a: lastValue(() => 0),
        b: lastValue(() => 0),
      },
    });

    // Two parallel nodes each invoke the same subgraph
    parentGraph.addNode("runA", async (s) => {
      const result = await childApp.invoke({ value: s.a });
      return { a: result.value };
    });
    parentGraph.addNode("runB", async (s) => {
      const result = await childApp.invoke({ value: s.b });
      return { b: result.value };
    });

    parentGraph.addEdge(START, ["runA", "runB"]);
    parentGraph.addEdge("runA", END);
    parentGraph.addEdge("runB", END);

    const parentApp = parentGraph.compile();

    // Run batch() with the same threadId to exercise concurrent invocations with shared prefix
    const results = await parentApp.batch(
      [{ a: 3, b: 5 }, { a: 7, b: 11 }],
      { threadId: "bug-0035-thread" },
    );

    // Each result should have independent doubling — no key collision corruption
    expect(results[0]!.a).toBe(6);
    expect(results[0]!.b).toBe(10);
    expect(results[1]!.a).toBe(14);
    expect(results[1]!.b).toBe(22);
  });

  it("BUG-0035: _perInvocationParentUpdates map is empty after concurrent batch completes (no leaks)", async () => {
    // After all concurrent invocations finish, the finally block in streaming.ts must
    // have cleaned up every per-invocation key — no leaked entries remain.

    type ChildState = { x: number };
    const childGraph = new StateGraph<ChildState>({
      channels: { x: lastValue(() => 0) },
    });
    childGraph.addNode("inc", (s) => ({ x: s.x + 1 }));
    childGraph.addEdge(START, "inc");
    childGraph.addEdge("inc", END);
    const childApp = childGraph.compile();

    type ParentState = { out: number };
    const parentGraph = new StateGraph<ParentState>({
      channels: { out: lastValue(() => 0) },
    });
    parentGraph.addNode("run", async (s) => {
      const res = await childApp.invoke({ x: s.out });
      return { out: res.x };
    });
    parentGraph.addEdge(START, "run");
    parentGraph.addEdge("run", END);

    const parentApp = parentGraph.compile();
    const runner = (childApp as unknown as { _runner: { _perInvocationParentUpdates: Map<string, unknown[]>; _perInvocationCheckpointer: Map<string, unknown> } })._runner;

    await parentApp.batch([{ out: 1 }, { out: 2 }, { out: 3 }]);

    // All per-invocation state should be cleaned up after batch completes
    expect(runner._perInvocationParentUpdates.size).toBe(0);
    expect(runner._perInvocationCheckpointer.size).toBe(0);
  });
});
