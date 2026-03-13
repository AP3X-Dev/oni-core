import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../../src/index.js";

describe("Static fan-out edges", () => {
  it("addEdge accepts array target for parallel execution", async () => {
    type S = { value: string; a: string; b: string };
    const g = new StateGraph<S>({
      channels: {
        value: lastValue(() => ""),
        a: lastValue(() => ""),
        b: lastValue(() => ""),
      },
    });

    g.addNode("init", async () => ({ value: "x" }));
    g.addNode("nodeA", async (s) => ({ a: `a:${s.value}` }));
    g.addNode("nodeB", async (s) => ({ b: `b:${s.value}` }));

    g.addEdge(START, "init");
    g.addEdge("init", ["nodeA", "nodeB"]);
    g.addEdge("nodeA", END);
    g.addEdge("nodeB", END);

    const app = g.compile();
    const result = await app.invoke({ value: "", a: "", b: "" });
    expect(result.a).toBe("a:x");
    expect(result.b).toBe("b:x");
  });

  it("single target still works as before", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("a", async () => ({ value: "done" }));
    g.addEdge(START, "a");
    g.addEdge("a", END);

    const app = g.compile();
    const result = await app.invoke({ value: "" });
    expect(result.value).toBe("done");
  });

  it("detects duplicate edges in array target", () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("a", async () => ({}));
    g.addNode("b", async () => ({}));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    expect(() => g.addEdge("a", ["b"])).toThrow();
  });
});
