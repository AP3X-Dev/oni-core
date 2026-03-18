import { describe, it, expect } from "vitest";
import { StateGraph } from "../graph.js";
import { START, END } from "../types.js";
import { MemoryCheckpointer } from "../checkpoint.js";

describe("BUG-0035: concurrent subgraph invocations use unique invocation keys", () => {
  it("BUG-0035: batch with subgraph node produces correct results for all inputs", async () => {
    // Before the fix, concurrent subgraph invocations sharing the same threadId
    // used identical invocation keys (just threadId), so the second call's
    // _perInvocationParentUpdates.set(key, []) overwrote the first's buffer,
    // causing parent updates to be silently lost.

    type S = { value: number };

    // Create a child graph that triples the value
    const child = new StateGraph<S>({
      channels: { value: { reducer: (_: number, b: number) => b, default: () => 0 } },
    });
    child.addNode("triple", async (s: S) => ({ value: s.value * 3 }));
    child.addEdge(START, "triple");
    child.addEdge("triple", END);
    const childGraph = child.compile();

    // Create parent graph with child as a subgraph node
    const parent = new StateGraph<S>({
      channels: { value: { reducer: (_: number, b: number) => b, default: () => 0 } },
    });
    parent.addSubgraph("run_child", childGraph);
    parent.addEdge(START, "run_child");
    parent.addEdge("run_child", END);
    const app = parent.compile({ checkpointer: new MemoryCheckpointer() });

    // batch() runs all inputs concurrently with the same threadId prefix.
    // With the old code (shared invocation key), concurrent calls would
    // corrupt each other's parent update buffers.
    const results = await app.batch(
      [{ value: 2 }, { value: 5 }, { value: 7 }],
      { threadId: "concurrent-test" },
    );

    expect(results).toHaveLength(3);
    expect(results[0]!.value).toBe(6);   // 2 * 3
    expect(results[1]!.value).toBe(15);  // 5 * 3
    expect(results[2]!.value).toBe(21);  // 7 * 3
  });
});
