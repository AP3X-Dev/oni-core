import { describe, it, expect } from "vitest";
import { StateGraph, START, END, appendList, Send } from "../../index.js";

describe("regression: send fan-out", () => {
  it("BUG-0041: all sends complete before error is thrown (Promise.allSettled, not Promise.all)", async () => {
    type S = { items: string[]; completed: string[] };

    const completionLog: string[] = [];

    const g = new StateGraph<S>({
      channels: {
        items: { reducer: (_, b) => b, default: () => [] as string[] },
        completed: appendList(() => [] as string[]),
      },
    });

    g.addNode("router", async () => ({}));
    g.addConditionalEdges("router", (state) =>
      state.items.map((item) => new Send("worker", { items: [item], completed: [] }))
    );

    g.addNode("worker", async (state) => {
      const item = state.items[0]!;
      if (item === "FAIL") {
        // Small delay so the other workers have started
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("deliberate failure");
      }
      // Track that this worker ran to completion
      await new Promise((r) => setTimeout(r, 30));
      completionLog.push(item);
      return { completed: [item] };
    });
    g.addEdge("worker", END);
    g.addEdge(START, "router");

    const app = g.compile();

    // One send will fail, but the others must still complete
    await expect(
      app.invoke({ items: ["A", "FAIL", "B"], completed: [] })
    ).rejects.toThrow("deliberate failure");

    // With Promise.allSettled (the fix), A and B complete before the error propagates.
    // With the old Promise.all, A and B would be abandoned mid-flight.
    expect(completionLog.sort()).toEqual(["A", "B"]);
  });
});
