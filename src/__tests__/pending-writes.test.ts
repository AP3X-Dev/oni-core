import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, MemoryCheckpointer } from "../../src/index.js";

type S = { a: string; b: string };

describe("Pending writes", () => {
  it("checkpoint records per-node writes", async () => {
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({
      channels: {
        a: lastValue(() => ""),
        b: lastValue(() => ""),
      },
    });

    g.addNode("nodeA", async () => ({ a: "from-A" }));
    g.addNode("nodeB", async () => ({ b: "from-B" }));
    g.addEdge(START, ["nodeA", "nodeB"]);
    g.addEdge("nodeA", END);
    g.addEdge("nodeB", END);

    const app = g.compile({ checkpointer: cp });
    await app.invoke({ a: "", b: "" }, { threadId: "t1" });

    const history = await cp.list("t1");
    const withWrites = history.find(c => c.pendingWrites && c.pendingWrites.length > 0);
    expect(withWrites).toBeDefined();
    expect(withWrites!.pendingWrites!.some(w => w.nodeId === "nodeA")).toBe(true);
    expect(withWrites!.pendingWrites!.some(w => w.nodeId === "nodeB")).toBe(true);
  });

  it("pendingWrites is empty when no nodes write", async () => {
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({
      channels: { a: lastValue(() => ""), b: lastValue(() => "") },
    });

    g.addNode("noop", async () => ({}));
    g.addEdge(START, "noop");
    g.addEdge("noop", END);

    const app = g.compile({ checkpointer: cp });
    await app.invoke({ a: "", b: "" }, { threadId: "t2" });

    const history = await cp.list("t2");
    for (const c of history) {
      expect(c.pendingWrites ?? []).toEqual([]);
    }
  });
});
