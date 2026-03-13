import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../../src/index.js";
import { streamEvents } from "../../src/stream-events.js";

describe("streamEvents (v2 protocol)", () => {
  it("emits on_chain_start and on_chain_end", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("worker", async () => ({ value: "done" }));
    g.addEdge(START, "worker");
    g.addEdge("worker", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of streamEvents(app, { value: "" })) {
      events.push(evt);
    }

    // Should have graph-level start/end
    expect(events[0].event).toBe("on_chain_start");
    expect(events[events.length - 1].event).toBe("on_chain_end");
  });

  it("emits on_chain_start/end for each node", async () => {
    type S = { a: string; b: string };
    const g = new StateGraph<S>({
      channels: {
        a: lastValue(() => ""),
        b: lastValue(() => ""),
      },
    });
    g.addNode("first", async () => ({ a: "x" }));
    g.addNode("second", async () => ({ b: "y" }));
    g.addEdge(START, "first");
    g.addEdge("first", "second");
    g.addEdge("second", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of streamEvents(app, { a: "", b: "" })) {
      events.push(evt);
    }

    const nodeStarts = events.filter(e => e.event === "on_chain_start" && e.name);
    const nodeEnds = events.filter(e => e.event === "on_chain_end" && e.name);
    expect(nodeStarts.length).toBeGreaterThanOrEqual(2);
    expect(nodeEnds.length).toBeGreaterThanOrEqual(2);
  });

  it("includes run_id and tags from config", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("a", async () => ({ value: "done" }));
    g.addEdge(START, "a");
    g.addEdge("a", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of streamEvents(app, { value: "" }, {
      threadId: "run-123",
      tags: ["test"],
    })) {
      events.push(evt);
    }

    expect(events[0].run_id).toBe("run-123");
    expect(events[0].tags).toEqual(["test"]);
  });
});
