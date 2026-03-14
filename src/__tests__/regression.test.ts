// ============================================================
// @oni.bot/core — Bug Regression Tests
// Covers: Bug 1 (token streaming ALS), Bug 3 (subgraph checkpointer),
//         Bug 4 (circuit breaker fallback)
// ============================================================

import { describe, it, expect } from "vitest";
import {
  StateGraph, START, END, lastValue,
  MemoryCheckpointer,
  emitToken,
} from "../index.js";
import { CircuitBreakerOpenError } from "../errors.js";

// ----------------------------------------------------------------
// Bug 1 — Parallel token streaming uses ALS (not a global)
// ----------------------------------------------------------------

describe("Bug 1 regression — parallel token streaming", () => {
  it("each parallel node's emitToken() routes to that node's messages event", async () => {
    type S = { a: string; b: string };

    const g = new StateGraph<S>({
      channels: {
        a: lastValue(() => ""),
        b: lastValue(() => ""),
      },
    });

    // Both nodes emit a distinct token
    g.addNode("node-a", async () => {
      emitToken("TOKEN_A");
      return { a: "done" };
    });

    g.addNode("node-b", async () => {
      emitToken("TOKEN_B");
      return { b: "done" };
    });

    // Fan-out from START so both nodes run in the same Promise.all superstep
    g.addEdge(START, ["node-a", "node-b"] as any);
    g.addEdge("node-a", END);
    g.addEdge("node-b", END);

    const app = g.compile();

    const messageEvents: Array<{ node: string; chunk: string }> = [];
    for await (const evt of app.stream({}, { streamMode: "messages" } as any)) {
      if ((evt as any).event === "messages") {
        messageEvents.push({
          node:  (evt as any).node,
          chunk: (evt as any).data?.chunk,
        });
      }
    }

    const aEvent = messageEvents.find((e) => e.node === "node-a");
    const bEvent = messageEvents.find((e) => e.node === "node-b");

    // Without the ALS fix, whichever node installed its handler last would
    // receive both tokens, and the other node's event would be missing.
    expect(aEvent).toBeDefined();
    expect(aEvent?.chunk).toBe("TOKEN_A");

    expect(bEvent).toBeDefined();
    expect(bEvent?.chunk).toBe("TOKEN_B");
  });
});

// ----------------------------------------------------------------
// Bug 3 regression — subgraph does not permanently overwrite child checkpointer
// ----------------------------------------------------------------

describe("Bug 3 regression — subgraph checkpointer restore", () => {
  it("child runner checkpointer is restored to null after parent invocation", async () => {
    type S = { value: string };

    const channels = { value: lastValue(() => "") };

    // Child compiled with NO checkpointer
    const childGraph = new StateGraph<S>({ channels });
    childGraph.addNode("inner", async () => ({ value: "child-result" }));
    childGraph.addEdge(START, "inner");
    childGraph.addEdge("inner", END);
    const child = childGraph.compile(); // no checkpointer

    // Verify initial state: child runner has no checkpointer
    const childRunner = (child as any)._runner;
    expect(childRunner.checkpointer).toBeNull();

    // Parent compiled WITH a checkpointer, uses child as subgraph
    const parentGraph = new StateGraph<S>({ channels });
    parentGraph.addSubgraph("sub", child);
    parentGraph.addEdge(START, "sub");
    parentGraph.addEdge("sub", END);

    const parentCheckpointer = new MemoryCheckpointer<S>();
    const parent = parentGraph.compile({ checkpointer: parentCheckpointer });

    // Invoke parent — child runner gets a NamespacedCheckpointer temporarily
    await parent.invoke({}, { threadId: "parent-thread" });

    // After invocation, child runner's checkpointer should be restored to null
    expect(childRunner.checkpointer).toBeNull();

    // Invoke child standalone — must not error or use the parent's checkpointer
    const result = await child.invoke({});
    expect(result.value).toBe("child-result");
  });

  it("child runner checkpointer is restored even when subgraph throws", async () => {
    type S = { value: string };
    const channels = { value: lastValue(() => "") };

    // Child that always throws
    const childGraph = new StateGraph<S>({ channels });
    childGraph.addNode("bad", async () => { throw new Error("child failure"); });
    childGraph.addEdge(START, "bad");
    childGraph.addEdge("bad", END);
    const child = childGraph.compile();

    const childRunner = (child as any)._runner;
    expect(childRunner.checkpointer).toBeNull();

    const parentGraph = new StateGraph<S>({ channels });
    parentGraph.addSubgraph("sub", child);
    parentGraph.addEdge(START, "sub");
    parentGraph.addEdge("sub", END);

    const parent = parentGraph.compile({ checkpointer: new MemoryCheckpointer<S>() });

    // Parent invoke should propagate the child's error
    await expect(parent.invoke({}, { threadId: "throw-thread" })).rejects.toThrow("child failure");

    // Child's checkpointer must be restored to null despite the throw
    expect(childRunner.checkpointer).toBeNull();
    expect(childRunner._isSubgraph).toBe(false);
  });
});

// ----------------------------------------------------------------
// Bug 4 regression — circuit breaker fallback receives real state + error
// ----------------------------------------------------------------

describe("Bug 4 regression — circuit breaker fallback args", () => {
  it("fallback is called with real state and CircuitBreakerOpenError (not undefined)", async () => {
    type S = { input: string; result: string };

    const fallbackCalls: Array<{ state: S; err: Error }> = [];

    const g = new StateGraph<S>({
      channels: {
        input:  lastValue(() => ""),
        result: lastValue(() => ""),
      },
    });

    g.addNode("flaky", async () => {
      throw new Error("intentional failure");
    }, {
      circuitBreaker: {
        threshold: 1,       // open after 1 failure
        resetAfter: 60_000, // stay open for the test duration
        fallback: (state, err) => {
          fallbackCalls.push({ state: state as S, err });
          return { result: "fallback-value" };
        },
      },
    });

    g.addEdge(START, "flaky");
    g.addEdge("flaky", END);

    const app = g.compile();

    // First call: node throws → circuit opens
    await expect(app.invoke({ input: "hello" })).rejects.toThrow();

    // Second call: circuit is open → fallback should be invoked
    const result = await app.invoke({ input: "hello" });
    expect(result.result).toBe("fallback-value");

    // Verify fallback received real state and real error
    expect(fallbackCalls).toHaveLength(1);
    expect(fallbackCalls[0].state).toBeDefined();
    expect(fallbackCalls[0].state).not.toBeUndefined();
    expect(fallbackCalls[0].err).toBeInstanceOf(CircuitBreakerOpenError);
  });
});
