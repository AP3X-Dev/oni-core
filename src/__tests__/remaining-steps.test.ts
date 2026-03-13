import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../../src/index.js";
import { getRemainingSteps } from "../../src/context.js";

describe("getRemainingSteps", () => {
  it("returns remaining steps inside a node", async () => {
    type S = { remaining: number };
    const g = new StateGraph<S>({
      channels: { remaining: lastValue(() => 0) },
    });

    g.addNode("check", async () => {
      const r = getRemainingSteps();
      return { remaining: r };
    });
    g.addEdge(START, "check");
    g.addEdge("check", END);

    const app = g.compile();
    const result = await app.invoke({ remaining: 0 }, { recursionLimit: 10 });
    expect(result.remaining).toBe(10);
  });

  it("decreases as steps progress", async () => {
    type S = { step: number; values: number[] };
    const g = new StateGraph<S>({
      channels: {
        step: lastValue(() => 0),
        values: lastValue(() => [] as number[]),
      },
    });

    g.addNode("a", async (state) => {
      const r = getRemainingSteps();
      return { step: state.step + 1, values: [...state.values, r] };
    });
    g.addConditionalEdges("a", (state) => (state.step < 3 ? "a" : END));
    g.addEdge(START, "a");

    const app = g.compile();
    const result = await app.invoke({ step: 0, values: [] }, { recursionLimit: 25 });
    expect(result.values).toEqual([25, 24, 23]);
  });

  it("throws when called outside node execution", () => {
    expect(() => getRemainingSteps()).toThrow("outside");
  });
});
