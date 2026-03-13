import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";
import { mockModel, assertGraph, createTestHarness } from "../testing/index.js";

// ----------------------------------------------------------------
// mockModel
// ----------------------------------------------------------------

describe("mockModel", () => {
  it("returns responses in sequence", async () => {
    const model = mockModel([
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ]);

    const r1 = await model.chat({ messages: [{ role: "user", content: "hello" }] });
    const r2 = await model.chat({ messages: [{ role: "user", content: "again" }] });

    expect(r1.content).toBe("first");
    expect(r2.content).toBe("second");
  });

  it("cycles back when responses exhausted", async () => {
    const model = mockModel([{ role: "assistant", content: "only" }]);

    await model.chat({ messages: [{ role: "user", content: "1" }] });
    const r2 = await model.chat({ messages: [{ role: "user", content: "2" }] });

    expect(r2.content).toBe("only");
  });

  it("has correct provider and modelId", () => {
    const model = mockModel([]);
    expect(model.provider).toBe("mock");
    expect(model.modelId).toBe("mock-model");
  });

  it("supports tool calls", async () => {
    const model = mockModel([
      {
        role: "assistant",
        content: "calling tool",
        toolCalls: [{ id: "tc1", name: "search", args: { query: "test" } }],
      },
    ]);

    const resp = await model.chat({ messages: [{ role: "user", content: "search for test" }] });

    expect(resp.toolCalls).toHaveLength(1);
    expect(resp.toolCalls![0].name).toBe("search");
    expect(resp.toolCalls![0].args).toEqual({ query: "test" });
    expect(resp.stopReason).toBe("tool_use");
  });

  it("tracks call history", async () => {
    const model = mockModel([{ role: "assistant", content: "ok" }]);

    await model.chat({ messages: [{ role: "user", content: "hi" }] });
    await model.chat({ messages: [{ role: "user", content: "bye" }] });

    expect(model.callHistory).toHaveLength(2);
    expect(model.callHistory[0].messages[0].content).toBe("hi");
    expect(model.callHistory[1].messages[0].content).toBe("bye");
  });

  it("reset clears history and index", async () => {
    const model = mockModel([
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ]);

    await model.chat({ messages: [{ role: "user", content: "1" }] });
    model.reset();

    expect(model.callHistory).toHaveLength(0);
    const r = await model.chat({ messages: [{ role: "user", content: "2" }] });
    expect(r.content).toBe("first"); // index reset to 0
  });

  it("streams content character by character", async () => {
    const model = mockModel([{ role: "assistant", content: "abc" }]);

    const chunks: string[] = [];
    for await (const chunk of model.stream({ messages: [{ role: "user", content: "hi" }] })) {
      if (chunk.type === "text" && chunk.text) chunks.push(chunk.text);
    }

    expect(chunks).toEqual(["a", "b", "c"]);
  });

  it("returns empty response for empty responses array", async () => {
    const model = mockModel([]);

    const r = await model.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("");
    expect(r.usage.inputTokens).toBe(0);
  });
});

// ----------------------------------------------------------------
// assertGraph
// ----------------------------------------------------------------

describe("assertGraph", () => {
  function makeGraph() {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("alpha", async (s) => ({ value: s.value + "a" }));
    g.addNode("beta", async (s) => ({ value: s.value + "b" }));
    g.addEdge(START, "alpha");
    g.addEdge("alpha", "beta");
    g.addEdge("beta", END);
    return g;
  }

  it("passes when nodes exist", () => {
    expect(() => assertGraph(makeGraph(), { hasNode: ["alpha", "beta"] })).not.toThrow();
  });

  it("fails when a node does not exist", () => {
    expect(() => assertGraph(makeGraph(), { hasNode: ["alpha", "missing"] })).toThrow(
      /expected node "missing" to exist/,
    );
  });

  it("asserts node count — pass", () => {
    expect(() => assertGraph(makeGraph(), { nodeCount: 2 })).not.toThrow();
  });

  it("asserts node count — fail", () => {
    expect(() => assertGraph(makeGraph(), { nodeCount: 5 })).toThrow(/expected 5 nodes, found 2/);
  });

  it("asserts edge existence — pass", () => {
    expect(() =>
      assertGraph(makeGraph(), { hasEdge: [["alpha", "beta"]] }),
    ).not.toThrow();
  });

  it("asserts edge existence — fail", () => {
    expect(() =>
      assertGraph(makeGraph(), { hasEdge: [["alpha", "missing"]] }),
    ).toThrow(/expected edge "alpha" -> "missing" not found/);
  });
});

// ----------------------------------------------------------------
// createTestHarness
// ----------------------------------------------------------------

describe("createTestHarness", () => {
  function buildGraph() {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("upper", async (s) => ({ value: s.value.toUpperCase() }));
    g.addEdge(START, "upper");
    g.addEdge("upper", END);
    return g;
  }

  it("invokes a graph with default config", async () => {
    const harness = createTestHarness(buildGraph());
    const result = await harness.invoke({ value: "hello" });
    expect(result.value).toBe("HELLO");
  });

  it("generates separate thread IDs per invocation", async () => {
    const harness = createTestHarness(buildGraph());
    // Two invocations should not interfere — both should succeed independently
    const r1 = await harness.invoke({ value: "aaa" });
    const r2 = await harness.invoke({ value: "bbb" });
    expect(r1.value).toBe("AAA");
    expect(r2.value).toBe("BBB");
  });

  it("collects stream events", async () => {
    const harness = createTestHarness(buildGraph());
    const events = await harness.collectStream({ value: "test" });
    expect(events.length).toBeGreaterThan(0);
    // At least one event should contain the uppercased value
    const hasUpper = events.some(
      (e) => e.data && typeof e.data === "object" && "value" in e.data && (e.data as any).value === "TEST",
    );
    expect(hasUpper).toBe(true);
  });
});
