import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, MemoryCheckpointer } from "../../src/index.js";

type S = { value: string };

describe("Checkpoint metadata", () => {
  it("stores config.metadata in checkpoints", async () => {
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("a", async () => ({ value: "done" }));
    g.addEdge(START, "a");
    g.addEdge("a", END);

    const app = g.compile({ checkpointer: cp });
    await app.invoke({ value: "" }, {
      threadId: "t1",
      metadata: { source: "test", version: 2 },
    });

    const history = await cp.list("t1");
    expect(history.length).toBeGreaterThan(0);
    // Every checkpoint should carry the metadata from config
    for (const c of history) {
      expect(c.metadata).toEqual({ source: "test", version: 2 });
    }
  });

  it("metadata defaults to undefined when not provided", async () => {
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("a", async () => ({ value: "done" }));
    g.addEdge(START, "a");
    g.addEdge("a", END);

    const app = g.compile({ checkpointer: cp });
    await app.invoke({ value: "" }, { threadId: "t2" });

    const history = await cp.list("t2");
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].metadata).toBeUndefined();
  });
});
