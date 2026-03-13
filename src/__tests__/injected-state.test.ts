import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../../src/index.js";
import { getCurrentState } from "../../src/context.js";

type S = { value: string; computed: string };

describe("getCurrentState", () => {
  it("returns current graph state inside a node", async () => {
    const g = new StateGraph<S>({
      channels: {
        value: lastValue(() => ""),
        computed: lastValue(() => ""),
      },
    });

    g.addNode("reader", async () => {
      const state = getCurrentState<S>();
      return { computed: `read:${state.value}` };
    });
    g.addEdge(START, "reader");
    g.addEdge("reader", END);

    const app = g.compile();
    const result = await app.invoke({ value: "hello", computed: "" });
    expect(result.computed).toBe("read:hello");
  });

  it("throws when called outside node execution", () => {
    expect(() => getCurrentState()).toThrow("outside");
  });
});
