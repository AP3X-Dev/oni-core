import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../../src/index.js";
import { getStreamWriter } from "../../src/context.js";

type S = { value: string };

describe("Multiple stream modes", () => {
  function buildGraph() {
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("worker", async () => {
      const w = getStreamWriter()!;
      w.token("hello");
      return { value: "done" };
    });
    g.addEdge(START, "worker");
    g.addEdge("worker", END);
    return g.compile();
  }

  it("accepts an array of stream modes", async () => {
    const app = buildGraph();
    const events: any[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: ["values", "messages"] })) {
      events.push(evt);
    }
    // Should have both state_update (from values) and messages events
    const modes = new Set(events.map(e => e.mode));
    expect(modes.has("values")).toBe(true);
    expect(modes.has("messages")).toBe(true);
  });

  it("single mode still works without mode field", async () => {
    const app = buildGraph();
    const events: any[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: "updates" })) {
      events.push(evt);
    }
    expect(events.length).toBeGreaterThan(0);
    // Single mode: mode field is undefined (backwards compat)
    expect(events[0].mode).toBeUndefined();
  });

  it("values + updates yields both event types", async () => {
    const app = buildGraph();
    const events: any[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: ["values", "updates"] })) {
      events.push(evt);
    }
    const hasStateUpdate = events.some(e => e.event === "state_update" && e.mode === "values");
    const hasNodeEnd = events.some(e => e.event === "node_end" && e.mode === "updates");
    expect(hasStateUpdate).toBe(true);
    expect(hasNodeEnd).toBe(true);
  });

  it("debug mode in array emits all event types", async () => {
    const app = buildGraph();
    const events: any[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: ["debug"] })) {
      events.push(evt);
    }
    const eventTypes = new Set(events.map(e => e.event));
    expect(eventTypes.has("node_start")).toBe(true);
    expect(eventTypes.has("node_end")).toBe(true);
  });
});
