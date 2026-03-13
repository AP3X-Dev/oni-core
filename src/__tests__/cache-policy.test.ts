import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../../src/index.js";

describe("CachePolicy", () => {
  it("caches node output and skips re-execution", async () => {
    type S = { input: string; output: string; step: number };
    let callCount = 0;

    const g = new StateGraph<S>({
      channels: {
        input: lastValue(() => ""),
        output: lastValue(() => ""),
        step: lastValue(() => 0),
      },
    });

    g.addNode("expensive", async (state) => {
      callCount++;
      return { output: `computed:${state.input}` };
    }, { cache: { key: (s) => (s as S).input } });

    g.addNode("increment", async (state) => ({ step: state.step + 1 }));

    g.addConditionalEdges("increment", (state) =>
      state.step < 3 ? "expensive" : END
    );
    g.addEdge(START, "expensive");
    g.addEdge("expensive", "increment");

    const app = g.compile();
    const result = await app.invoke({ input: "hello", output: "", step: 0 });

    expect(result.output).toBe("computed:hello");
    expect(callCount).toBe(1);
  });

  it("cache misses when input state changes", async () => {
    type S = { input: string; output: string };
    let callCount = 0;

    const g = new StateGraph<S>({
      channels: {
        input: lastValue(() => ""),
        output: lastValue(() => ""),
      },
    });

    g.addNode("compute", async (state) => {
      callCount++;
      return { output: `v${callCount}:${state.input}` };
    }, { cache: true });
    g.addEdge(START, "compute");
    g.addEdge("compute", END);

    const app = g.compile();
    await app.invoke({ input: "a", output: "" });
    expect(callCount).toBe(1);

    await app.invoke({ input: "b", output: "" });
    expect(callCount).toBe(2);
  });

  it("uncached nodes always execute", async () => {
    type S = { value: number };
    let callCount = 0;

    const g = new StateGraph<S>({
      channels: { value: lastValue(() => 0) },
    });
    g.addNode("counter", async (s) => {
      callCount++;
      return { value: s.value + 1 };
    });
    g.addConditionalEdges("counter", (s) => s.value < 3 ? "counter" : END);
    g.addEdge(START, "counter");

    const app = g.compile();
    await app.invoke({ value: 0 });
    expect(callCount).toBe(3);
  });
});
