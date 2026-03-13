import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../../src/index.js";

describe("Subgraph streaming", () => {
  function buildGraphs() {
    type Inner = { text: string; result: string };
    const inner = new StateGraph<Inner>({
      channels: {
        text: lastValue(() => ""),
        result: lastValue(() => ""),
      },
    });
    inner.addNode("process", async (state) => {
      return { result: `processed:${state.text}` };
    });
    inner.addEdge(START, "process");
    inner.addEdge("process", END);

    type Outer = { text: string; result: string };
    const outer = new StateGraph<Outer>({
      channels: {
        text: lastValue(() => ""),
        result: lastValue(() => ""),
      },
    });
    outer.addSubgraph("child", inner.compile() as any);
    outer.addNode("finish", async (state) => {
      return { result: `${state.result}+finished` };
    });
    outer.addEdge(START, "child");
    outer.addEdge("child", "finish");
    outer.addEdge("finish", END);
    return outer.compile();
  }

  it("propagates subgraph events with namespace prefix in updates mode", async () => {
    const app = buildGraphs();
    const events: any[] = [];
    for await (const evt of app.stream({ text: "hello" }, { streamMode: "updates" })) {
      events.push(evt);
    }
    // Should see events from child subgraph with prefixed node names
    const childEvents = events.filter((e: any) => e.node && e.node.startsWith("child:"));
    expect(childEvents.length).toBeGreaterThan(0);
  });

  it("propagates subgraph events in debug mode", async () => {
    const app = buildGraphs();
    const events: any[] = [];
    for await (const evt of app.stream({ text: "hello" }, { streamMode: "debug" })) {
      events.push(evt);
    }
    const childStarts = events.filter((e: any) => e.node?.startsWith("child:") && e.event === "node_start");
    const childEnds = events.filter((e: any) => e.node?.startsWith("child:") && e.event === "node_end");
    expect(childStarts.length).toBeGreaterThan(0);
    expect(childEnds.length).toBeGreaterThan(0);
  });

  it("still produces correct final state", async () => {
    const app = buildGraphs();
    const result = await app.invoke({ text: "hello" });
    expect(result.result).toBe("processed:hello+finished");
  });
});
