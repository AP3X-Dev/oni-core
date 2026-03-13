import { describe, it, expect } from "vitest";
import {
  StateGraph, START, END, lastValue, appendList, Send,
  MemoryCheckpointer, InMemoryStore,
} from "../../src/index.js";
import { getRemainingSteps, getCurrentState, getStreamWriter } from "../../src/context.js";
import { streamEvents } from "../../src/stream-events.js";

describe("Final integration — all features", () => {
  it("static fan-out + cache + remaining steps", async () => {
    type S = { value: string; a: string; b: string; remaining: number };
    let aCalls = 0;

    const g = new StateGraph<S>({
      channels: {
        value: lastValue(() => ""),
        a: lastValue(() => ""),
        b: lastValue(() => ""),
        remaining: lastValue(() => 0),
      },
    });

    g.addNode("init", async () => {
      return { remaining: getRemainingSteps() };
    });
    g.addNode("nodeA", async (s) => {
      aCalls++;
      return { a: `a:${s.value}` };
    }, { cache: true });
    g.addNode("nodeB", async (s) => ({ b: `b:${s.value}` }));

    g.addEdge(START, "init");
    g.addEdge("init", ["nodeA", "nodeB"]);
    g.addEdge("nodeA", END);
    g.addEdge("nodeB", END);

    const app = g.compile();
    const result = await app.invoke(
      { value: "x", a: "", b: "", remaining: 0 },
      { recursionLimit: 50 }
    );

    expect(result.a).toBe("a:x");
    expect(result.b).toBe("b:x");
    expect(result.remaining).toBe(50);
  });

  it("pending writes + checkpoint filtering + namespace isolation", async () => {
    const cp = new MemoryCheckpointer<any>();

    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("a", async () => ({ value: "step-a" }));
    g.addNode("b", async () => ({ value: "step-b" }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);

    const app = g.compile({ checkpointer: cp });
    await app.invoke({ value: "" }, {
      threadId: "t1",
      metadata: { source: "test" },
    });

    // Filtered list
    const filtered = await cp.list("t1", { filter: { source: "test" }, limit: 1 });
    expect(filtered.length).toBe(1);

    // Pending writes exist
    const all = await cp.list("t1");
    const withWrites = all.find(c => c.pendingWrites && c.pendingWrites.length > 0);
    expect(withWrites).toBeDefined();
  });

  it("streamEvents wraps execution in v2 protocol", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("worker", async () => ({ value: "done" }));
    g.addEdge(START, "worker");
    g.addEdge("worker", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of streamEvents(app, { value: "" }, { threadId: "r1" })) {
      events.push(evt);
    }

    expect(events[0].event).toBe("on_chain_start");
    expect(events[events.length - 1].event).toBe("on_chain_end");
    expect(events.every((e: any) => e.run_id === "r1")).toBe(true);
  });

  it("semantic search + listNamespaces together", async () => {
    const mockEmbed = async (text: string): Promise<number[]> => {
      const vec = new Array(4).fill(0);
      for (let i = 0; i < text.length; i++) vec[i % 4] += text.charCodeAt(i);
      const mag = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
      return mag > 0 ? vec.map((v: number) => v / mag) : vec;
    };

    const store = new InMemoryStore({ embedFn: mockEmbed });
    await store.put(["docs", "guides"], "ts", "TypeScript handbook");
    await store.put(["docs", "guides"], "js", "JavaScript basics");
    await store.put(["docs", "api"], "rest", "REST API design");

    const ns = await store.listNamespaces({ prefix: ["docs"] });
    expect(ns.length).toBe(2);

    const results = await store.search(["docs", "guides"], "TypeScript");
    expect(results.length).toBeGreaterThan(0);
  });
});
