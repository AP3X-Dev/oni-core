import { describe, it, expect, vi } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";
import type { TracerLike, SpanLike } from "../telemetry.js";

function createMockTracer() {
  const spans: Array<{ name: string; attrs: Record<string, unknown>; ended: boolean; errors: Error[] }> = [];

  const tracer: TracerLike = {
    startSpan(name: string) {
      const span: SpanLike & { _record: typeof spans[0] } = {
        _record: { name, attrs: {}, ended: false, errors: [] },
        setAttribute(key, value) { this._record.attrs[key] = value; return this; },
        setStatus() { return this; },
        recordException(err: Error) { this._record.errors.push(err); },
        end() { this._record.ended = true; },
      };
      spans.push(span._record);
      return span;
    },
  };

  return { tracer, spans };
}

type SimpleState = { value: number };

describe("Telemetry integration", () => {
  it("creates graph and node spans during invoke", async () => {
    const { tracer, spans } = createMockTracer();

    const g = new StateGraph<SimpleState>({
      channels: { value: lastValue(() => 0) },
    });
    g.addNode("increment", async (s) => ({ value: s.value + 1 }));
    g.addEdge(START, "increment");
    g.addEdge("increment", END);

    const skeleton = g.compile({ tracer });
    await skeleton.invoke({ value: 0 });

    // Should have at least a graph span and a node span
    const graphSpans = spans.filter((s) => s.name.startsWith("oni.graph."));
    const nodeSpans = spans.filter((s) => s.name.startsWith("oni.node."));

    expect(graphSpans.length).toBeGreaterThanOrEqual(1);
    expect(nodeSpans.length).toBeGreaterThanOrEqual(1);

    // All spans should be ended
    for (const s of spans) {
      expect(s.ended).toBe(true);
    }

    // Graph span should have thread_id and steps attributes
    expect(graphSpans[0].attrs["oni.thread_id"]).toBeDefined();
    expect(graphSpans[0].attrs["oni.steps"]).toBeDefined();

    // Node span should have node name
    expect(nodeSpans[0].attrs["oni.node_name"]).toBe("increment");
  });

  it("records errors on node spans when nodes fail", async () => {
    const { tracer, spans } = createMockTracer();

    const g = new StateGraph<SimpleState>({
      channels: { value: lastValue(() => 0) },
    });
    g.addNode("failing", async () => { throw new Error("boom"); });
    g.addEdge(START, "failing");
    g.addEdge("failing", END);

    const skeleton = g.compile({ tracer });
    await expect(skeleton.invoke({ value: 0 })).rejects.toThrow("boom");

    const nodeSpans = spans.filter((s) => s.name.startsWith("oni.node."));
    expect(nodeSpans.length).toBe(1);
    expect(nodeSpans[0].errors.length).toBe(1);
    expect(nodeSpans[0].errors[0].message).toBe("boom");
    expect(nodeSpans[0].ended).toBe(true);
  });

  it("creates checkpoint spans when checkpointer is configured", async () => {
    const { tracer, spans } = createMockTracer();
    const { MemoryCheckpointer } = await import("../checkpoint.js");

    const g = new StateGraph<SimpleState>({
      channels: { value: lastValue(() => 0) },
    });
    g.addNode("increment", async (s) => ({ value: s.value + 1 }));
    g.addEdge(START, "increment");
    g.addEdge("increment", END);

    const skeleton = g.compile({
      tracer,
      checkpointer: new MemoryCheckpointer(),
    });
    await skeleton.invoke({ value: 0 }, { threadId: "test-thread" });

    const cpSpans = spans.filter((s) => s.name.startsWith("oni.checkpoint."));
    expect(cpSpans.length).toBeGreaterThanOrEqual(1);
    expect(cpSpans[0].attrs["oni.thread_id"]).toBe("test-thread");
    expect(cpSpans[0].ended).toBe(true);
  });

  it("works without tracer (no-op)", async () => {
    const g = new StateGraph<SimpleState>({
      channels: { value: lastValue(() => 0) },
    });
    g.addNode("increment", async (s) => ({ value: s.value + 1 }));
    g.addEdge(START, "increment");
    g.addEdge("increment", END);

    // No tracer passed — should work fine with NOOP_SPAN
    const skeleton = g.compile();
    const result = await skeleton.invoke({ value: 0 });
    expect(result.value).toBe(1);
  });
});
