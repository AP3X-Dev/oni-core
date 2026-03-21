import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, MemoryCheckpointer } from "../../src/index.js";

describe("Checkpoint namespace isolation", () => {
  it("subgraph checkpoints are isolated from parent", async () => {
    const cp = new MemoryCheckpointer<any>();

    // Inner graph
    type Inner = { text: string };
    const inner = new StateGraph<Inner>({
      channels: { text: lastValue(() => "") },
    });
    inner.addNode("process", async (s) => ({ text: `processed:${s.text}` }));
    inner.addEdge(START, "process");
    inner.addEdge("process", END);

    // Outer graph
    type Outer = { text: string; result: string };
    const outer = new StateGraph<Outer>({
      channels: {
        text: lastValue(() => ""),
        result: lastValue(() => ""),
      },
    });
    outer.addSubgraph("child", inner.compile({ checkpointer: cp }) as any);
    outer.addNode("finish", async (s) => ({ result: `done:${s.text}` }));
    outer.addEdge(START, "child");
    outer.addEdge("child", "finish");
    outer.addEdge("finish", END);

    const app = outer.compile({ checkpointer: cp });
    await app.invoke({ text: "hello", result: "" }, { threadId: "parent-1" });

    // Parent checkpoints should exist
    const parentHistory = await cp.list("parent-1");
    expect(parentHistory.length).toBeGreaterThan(0);

    // Child checkpoints should be namespaced under "child:parent-1"
    const childHistory = await cp.list("child:parent-1");
    expect(childHistory.length).toBeGreaterThan(0);

    // The child checkpoints are stored with the namespaced threadId
    const childFinal = childHistory[childHistory.length - 1];
    expect(childFinal.threadId).toBe("child:parent-1");

    // Parent's final state includes "result" from "finish" node
    const parentFinal = parentHistory[parentHistory.length - 1];
    expect((parentFinal.state as any).result).toBe("done:processed:hello");
    // Child's final state should NOT have "result" set (child only has "text" channel)
    expect((childFinal.state as any).result).not.toBe("done:processed:hello");
  });

  it("invoke still works correctly with namespace isolation", async () => {
    const cp = new MemoryCheckpointer<any>();

    type Inner = { value: string };
    const inner = new StateGraph<Inner>({
      channels: { value: lastValue(() => "") },
    });
    inner.addNode("double", async (s) => ({ value: s.value + s.value }));
    inner.addEdge(START, "double");
    inner.addEdge("double", END);

    type Outer = { value: string };
    const outer = new StateGraph<Outer>({
      channels: { value: lastValue(() => "") },
    });
    outer.addSubgraph("sub", inner.compile({ checkpointer: cp }) as any);
    outer.addEdge(START, "sub");
    outer.addEdge("sub", END);

    const app = outer.compile({ checkpointer: cp });
    const result = await app.invoke({ value: "ab" }, { threadId: "t1" });
    expect(result.value).toBe("abab");
  });
});
