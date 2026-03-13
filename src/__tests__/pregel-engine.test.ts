import { describe, it, expect } from "vitest";
import { StateGraph } from "../graph.js";
import {
  START, END, lastValue, appendList, ephemeralValue,
} from "../types.js";
import { MemoryCheckpointer } from "../checkpoint.js";
import { RecursionLimitError, NodeExecutionError } from "../errors.js";

/* ------------------------------------------------------------------ */
/*  Pregel Engine — direct tests                                      */
/* ------------------------------------------------------------------ */

// ── batch() ───────────────────────────────────────────────────────

describe("Pregel batch()", () => {
  it("runs multiple inputs in parallel and returns results in order", async () => {
    type S = { value: number };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => 0) } });
    g.addNode("double", (s) => ({ value: s.value * 2 }));
    g.addEdge(START, "double");
    g.addEdge("double", END);
    const app = g.compile();

    const results = await app.batch([
      { value: 1 },
      { value: 5 },
      { value: 10 },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]!.value).toBe(2);
    expect(results[1]!.value).toBe(10);
    expect(results[2]!.value).toBe(20);
  });

  it("batch with threadId creates isolated threads per input", async () => {
    type S = { count: number };
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({ channels: { count: lastValue(() => 0) } });
    g.addNode("inc", (s) => ({ count: s.count + 1 }));
    g.addEdge(START, "inc");
    g.addEdge("inc", END);
    const app = g.compile({ checkpointer: cp });

    await app.batch(
      [{ count: 10 }, { count: 20 }],
      { threadId: "batch" },
    );

    // Each batch item gets its own thread: batch-0, batch-1
    const s0 = await app.getState({ threadId: "batch-0" });
    const s1 = await app.getState({ threadId: "batch-1" });
    expect(s0!.count).toBe(11);
    expect(s1!.count).toBe(21);
  });
});

// ── Ephemeral channels ────────────────────────────────────────────

describe("Pregel ephemeral channels", () => {
  it("resets ephemeral channel between supersteps", async () => {
    type S = { result: string; scratch: string };
    const g = new StateGraph<S>({
      channels: {
        result: lastValue(() => ""),
        scratch: ephemeralValue(() => "empty"),
      },
    });

    g.addNode("step1", () => ({ result: "done1", scratch: "wrote-scratch" }));
    g.addNode("step2", (s) => ({ result: `${s.result}+done2`, scratch: s.scratch }));
    g.addEdge(START, "step1");
    g.addEdge("step1", "step2");
    g.addEdge("step2", END);
    const app = g.compile();

    const result = await app.invoke({ result: "" });
    // step2 should see scratch reset to "empty", not "wrote-scratch"
    expect(result.result).toBe("done1+done2");
    expect(result.scratch).toBe("empty");
  });

  it("ephemeral channel has correct default on first superstep", async () => {
    type S = { data: string; temp: string };
    const g = new StateGraph<S>({
      channels: {
        data: lastValue(() => ""),
        temp: ephemeralValue(() => "default-val"),
      },
    });

    g.addNode("check", (s) => ({ data: s.temp }));
    g.addEdge(START, "check");
    g.addEdge("check", END);
    const app = g.compile();

    const result = await app.invoke({});
    expect(result.data).toBe("default-val");
  });
});

// ── Recursion limit ───────────────────────────────────────────────

describe("Pregel recursion limit", () => {
  it("throws RecursionLimitError when cycle exceeds limit", async () => {
    type S = { count: number };
    const g = new StateGraph<S>({ channels: { count: lastValue(() => 0) } });

    g.addNode("loop", (s) => ({ count: s.count + 1 }));
    g.addEdge(START, "loop");
    g.addConditionalEdges("loop", (s) => (s.count < 100 ? "loop" : END));
    const app = g.compile();

    await expect(
      app.invoke({ count: 0 }, { recursionLimit: 5 })
    ).rejects.toThrow(RecursionLimitError);
  });

  it("does not throw when within recursion limit", async () => {
    type S = { count: number };
    const g = new StateGraph<S>({ channels: { count: lastValue(() => 0) } });

    g.addNode("loop", (s) => ({ count: s.count + 1 }));
    g.addEdge(START, "loop");
    g.addConditionalEdges("loop", (s) => (s.count < 3 ? "loop" : END));
    const app = g.compile();

    const result = await app.invoke({ count: 0 }, { recursionLimit: 10 });
    expect(result.count).toBe(3);
  });
});

// ── State management APIs ─────────────────────────────────────────

describe("Pregel state management", () => {
  it("getState returns null without checkpointer", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", END);
    const app = g.compile();

    await app.invoke({ val: 0 });
    const state = await app.getState({ threadId: "t1" });
    expect(state).toBeNull();
  });

  it("getState returns final state with checkpointer", async () => {
    type S = { val: number };
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 42 }));
    g.addEdge(START, "a");
    g.addEdge("a", END);
    const app = g.compile({ checkpointer: cp });

    await app.invoke({ val: 0 }, { threadId: "thread-1" });
    const state = await app.getState({ threadId: "thread-1" });
    expect(state!.val).toBe(42);
  });

  it("updateState modifies persisted state", async () => {
    type S = { val: number };
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 10 }));
    g.addEdge(START, "a");
    g.addEdge("a", END);
    const app = g.compile({ checkpointer: cp });

    await app.invoke({ val: 0 }, { threadId: "up-thread" });
    await app.updateState({ threadId: "up-thread" }, { val: 999 });

    const state = await app.getState({ threadId: "up-thread" });
    expect(state!.val).toBe(999);
  });

  it("getHistory returns checkpoint history", async () => {
    type S = { val: number };
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 1 }));
    g.addNode("b", (s) => ({ val: s.val + 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    const app = g.compile({ checkpointer: cp });

    await app.invoke({ val: 0 }, { threadId: "hist-thread" });
    const history = await app.getHistory({ threadId: "hist-thread" });
    expect(history.length).toBeGreaterThanOrEqual(2);
    // Steps should be in ascending order in the stored checkpoints
    const steps = history.map((h) => h.step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("getStateAt returns state at specific step", async () => {
    type S = { val: number };
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 10 }));
    g.addNode("b", () => ({ val: 20 }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    const app = g.compile({ checkpointer: cp });

    await app.invoke({ val: 0 }, { threadId: "time-travel" });
    const history = await app.getHistory({ threadId: "time-travel" });

    // First checkpoint (step 1) should have val=10 (after node "a")
    const step1 = history.find((h) => h.step === 1);
    expect(step1).toBeDefined();
    const step1State = await app.getStateAt({ threadId: "time-travel", step: step1!.step });
    expect(step1State).toBeDefined();
    expect(step1State!.val).toBe(10);
  });

  it("forkFrom creates a new thread from a checkpoint", async () => {
    type S = { val: number };
    const cp = new MemoryCheckpointer<S>();
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 10 }));
    g.addNode("b", () => ({ val: 20 }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    const app = g.compile({ checkpointer: cp });

    await app.invoke({ val: 0 }, { threadId: "original" });
    const history = await app.getHistory({ threadId: "original" });

    // Fork from step 1 (after node "a")
    await app.forkFrom({ threadId: "original", step: history[0]!.step, newThreadId: "forked" });
    const forkedHistory = await app.getHistory({ threadId: "forked" });
    expect(forkedHistory.length).toBeGreaterThan(0);

    // Forked thread should have state from step 1 (val=10)
    const forkedState = await app.getState({ threadId: "forked" });
    expect(forkedState).toBeDefined();
    expect(forkedState!.val).toBe(10);
  });
});

// ── Channel reducers ──────────────────────────────────────────────

describe("Pregel channel reducers", () => {
  it("appendList reducer accumulates across multiple nodes", async () => {
    type S = { items: string[] };
    const g = new StateGraph<S>({ channels: { items: appendList() } });
    g.addNode("a", () => ({ items: ["from-a"] }));
    g.addNode("b", () => ({ items: ["from-b"] }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    const app = g.compile();

    const result = await app.invoke({ items: ["initial"] });
    expect(result.items).toEqual(["initial", "from-a", "from-b"]);
  });

  it("lastValue reducer takes the latest value", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 10 }));
    g.addNode("b", () => ({ val: 20 }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    const app = g.compile();

    const result = await app.invoke({ val: 0 });
    expect(result.val).toBe(20);
  });

  it("undefined updates are skipped by applyUpdate", async () => {
    type S = { a: number; b: number };
    const g = new StateGraph<S>({
      channels: {
        a: lastValue(() => 0),
        b: lastValue(() => 0),
      },
    });
    // Only update "a", leave "b" as undefined in the return
    g.addNode("partial", () => ({ a: 42 }) as Partial<S>);
    g.addEdge(START, "partial");
    g.addEdge("partial", END);
    const app = g.compile();

    const result = await app.invoke({ a: 0, b: 99 });
    expect(result.a).toBe(42);
    expect(result.b).toBe(99); // unchanged
  });
});

// ── Node error wrapping ───────────────────────────────────────────

describe("Pregel error handling", () => {
  it("wraps plain errors in NodeExecutionError", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("boom", () => { throw new Error("plain error"); });
    g.addEdge(START, "boom");
    g.addEdge("boom", END);
    const app = g.compile();

    try {
      await app.invoke({ val: 0 });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NodeExecutionError);
      expect((err as NodeExecutionError).message).toContain("boom");
      expect((err as NodeExecutionError).message).toContain("plain error");
    }
  });

  it("void-returning nodes do not crash the engine", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("noop", () => {}); // returns undefined
    g.addNode("after", () => ({ val: 42 }));
    g.addEdge(START, "noop");
    g.addEdge("noop", "after");
    g.addEdge("after", END);
    const app = g.compile();

    const result = await app.invoke({ val: 0 });
    expect(result.val).toBe(42);
  });
});

// ── Stream modes ──────────────────────────────────────────────────

describe("Pregel stream modes", () => {
  it("values mode emits state_update events", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", END);
    const app = g.compile();

    const events = [];
    for await (const evt of app.stream({ val: 0 }, { streamMode: "values" })) {
      events.push(evt);
    }

    const stateUpdates = events.filter((e) => e.event === "state_update");
    expect(stateUpdates.length).toBeGreaterThanOrEqual(2); // initial + after node + final
  });

  it("updates mode emits node_end events", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 1 }));
    g.addNode("b", () => ({ val: 2 }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    const app = g.compile();

    const events = [];
    for await (const evt of app.stream({ val: 0 }, { streamMode: "updates" })) {
      events.push(evt);
    }

    const nodeEnds = events.filter((e) => e.event === "node_end");
    expect(nodeEnds.length).toBe(2);
    expect(nodeEnds[0]!.node).toBe("a");
    expect(nodeEnds[1]!.node).toBe("b");
  });

  it("debug mode emits node_start and node_end events", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", END);
    const app = g.compile();

    const events = [];
    for await (const evt of app.stream({ val: 0 }, { streamMode: "debug" })) {
      events.push(evt);
    }

    const types = events.map((e) => e.event);
    expect(types).toContain("node_start");
    expect(types).toContain("node_end");
  });

  it("multi-mode tags events with mode", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({ channels: { val: lastValue(() => 0) } });
    g.addNode("a", () => ({ val: 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", END);
    const app = g.compile();

    const events = [];
    for await (const evt of app.stream({ val: 0 }, { streamMode: ["values", "updates"] })) {
      events.push(evt);
    }

    // Every event should have a mode tag
    for (const evt of events) {
      expect((evt as any).mode).toBeDefined();
      expect(["values", "updates"]).toContain((evt as any).mode);
    }
  });
});
