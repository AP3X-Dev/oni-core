import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, appendList, Send } from "../../src/index.js";
import { getStreamWriter, getCurrentState } from "../../src/context.js";

describe("Medium priority integration", () => {
  it("multi-mode + subgraph streaming + messages", async () => {
    type Inner = { text: string; summary: string };
    const inner = new StateGraph<Inner>({
      channels: {
        text: lastValue(() => ""),
        summary: lastValue(() => ""),
      },
    });
    inner.addNode("analyze", async (state) => {
      const w = getStreamWriter()!;
      w.token("Analyzing...");
      return { summary: `done:${state.text}` };
    });
    inner.addEdge(START, "analyze");
    inner.addEdge("analyze", END);

    type Outer = { text: string; summary: string };
    const outer = new StateGraph<Outer>({
      channels: {
        text: lastValue(() => ""),
        summary: lastValue(() => ""),
      },
    });
    outer.addSubgraph("sub", inner.compile() as any);
    outer.addEdge(START, "sub");
    outer.addEdge("sub", END);

    const app = outer.compile();
    const events: any[] = [];
    for await (const evt of app.stream({ text: "test" }, { streamMode: ["updates", "messages"] })) {
      events.push(evt);
    }

    const updateEvents = events.filter(e => e.mode === "updates");
    const messageEvents = events.filter(e => e.mode === "messages");
    expect(updateEvents.length).toBeGreaterThan(0);
    expect(messageEvents.length).toBeGreaterThan(0);
  });

  it("map-reduce with getCurrentState", async () => {
    type S = { items: string[]; results: string[] };
    const g = new StateGraph<S>({
      channels: {
        items: lastValue(() => [] as string[]),
        results: appendList(() => [] as string[]),
      },
    });

    g.addNode("dispatch", async () => ({}));
    g.addConditionalEdges("dispatch", (state) => {
      return state.items.map(item => new Send("process", { items: [item] }));
    });

    g.addNode("process", async () => {
      const state = getCurrentState<S>();
      const item = state.items[0];
      return { results: [`processed:${item}`] };
    });
    g.addEdge("process", END);
    g.addEdge(START, "dispatch");

    const app = g.compile();
    const result = await app.invoke({ items: ["x", "y"], results: [] });
    expect(result.results.sort()).toEqual(["processed:x", "processed:y"]);
  });
});
