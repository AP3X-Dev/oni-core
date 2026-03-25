/**
 * BUG-0351: Subgraph streaming hard-coded childStreamMode as
 * ["debug", "values"], ignoring the parent's actual requested stream modes
 * and never collecting "custom" or "messages" events from subgraphs.
 *
 * Fix: derive childStreamMode from the parent's active mode flags instead
 * of using a hard-coded list.
 */

import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";

type Inner = { text: string; result: string };
type Outer = { text: string; result: string };

function buildGraphs() {
  const inner = new StateGraph<Inner>({
    channels: {
      text: lastValue(() => ""),
      result: lastValue(() => ""),
    },
  });
  inner.addNode("process", async (state: Inner) => {
    return { result: `processed:${state.text}` };
  });
  inner.addEdge(START, "process");
  inner.addEdge("process", END);

  const outer = new StateGraph<Outer>({
    channels: {
      text: lastValue(() => ""),
      result: lastValue(() => ""),
    },
  });
  outer.addSubgraph("child", inner.compile() as any);
  outer.addNode("finish", async (state: Outer) => {
    return { result: `${state.result}+finished` };
  });
  outer.addEdge(START, "child");
  outer.addEdge("child", "finish");
  outer.addEdge("finish", END);
  return outer.compile();
}

describe("Subgraph streaming childStreamMode derivation (BUG-0351)", () => {
  it("updates mode: subgraph node_end events are emitted when parent requests updates", async () => {
    const app = buildGraphs();
    const events: any[] = [];
    for await (const evt of app.stream(
      { text: "hello" },
      { streamMode: "updates" },
    )) {
      events.push(evt);
    }
    // With the fix, "updates" mode is propagated to the child and we receive
    // node_end events from the subgraph namespaced with "child:"
    const childNodeEnds = events.filter(
      (e: any) => e.node?.startsWith("child:") && e.event === "node_end",
    );
    expect(childNodeEnds.length).toBeGreaterThan(0);
  });

  it("values mode: subgraph state_update events are emitted when parent requests values", async () => {
    const app = buildGraphs();
    const events: any[] = [];
    for await (const evt of app.stream(
      { text: "world" },
      { streamMode: "values" },
    )) {
      events.push(evt);
    }
    // values mode should propagate to child, producing state_update events
    const stateUpdates = events.filter((e: any) => e.event === "state_update");
    expect(stateUpdates.length).toBeGreaterThan(0);
  });

  it("debug mode: subgraph node_start and node_end events are emitted", async () => {
    const app = buildGraphs();
    const events: any[] = [];
    for await (const evt of app.stream(
      { text: "test" },
      { streamMode: "debug" },
    )) {
      events.push(evt);
    }
    const childStarts = events.filter(
      (e: any) => e.node?.startsWith("child:") && e.event === "node_start",
    );
    const childEnds = events.filter(
      (e: any) => e.node?.startsWith("child:") && e.event === "node_end",
    );
    expect(childStarts.length).toBeGreaterThan(0);
    expect(childEnds.length).toBeGreaterThan(0);
  });

  it("final result is unaffected regardless of stream mode", async () => {
    const app = buildGraphs();
    const result = await app.invoke({ text: "hello" });
    expect(result.result).toBe("processed:hello+finished");
  });
});
