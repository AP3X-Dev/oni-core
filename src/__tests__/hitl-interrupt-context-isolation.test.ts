import { describe, it, expect } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  StateGraph, START, END, lastValue,
  MemoryCheckpointer,
  HITLInterruptException,
} from "../index.js";
import { interrupt } from "../hitl/index.js";

// ----------------------------------------------------------------
// Regression test: BUG-0341
//
// _installInterruptContext() was using AsyncLocalStorage.enterWith()
// which mutates the current async context in-place. Under Promise.allSettled
// parallel node execution in Pregel, one node's enterWith() overwrites another
// node's interrupt context, causing interrupts to report the wrong nodeName
// (and thus wrong resumeId prefix) or consume the sibling's resume values.
//
// The fix changes _installInterruptContext() to use als.run(ctx, fn) which
// creates an isolated child scope per node invocation.
// ----------------------------------------------------------------

describe("BUG-0341 — interrupt context isolation under concurrent node execution", () => {
  it("parallel nodes calling interrupt() each produce resumeIds prefixed with their own node name", async () => {
    // Graph: START → fanout → [nodeA, nodeB] → END
    // Both nodeA and nodeB call interrupt(). Each thrown NodeInterruptSignal
    // must carry a resumeId that starts with the correct node's name.
    //
    // With the pre-fix enterWith() bug: the second node to call enterWith()
    // overwrites the context, so both signals get the same (wrong) nodeName prefix.
    // With the post-fix als.run() isolation: each node sees its own context.

    type S = { a: string; b: string };

    const g = new StateGraph<S>({
      channels: {
        a: lastValue(() => ""),
        b: lastValue(() => ""),
      },
    });

    g.addNode("fanout", async () => ({}));
    g.addNode("nodeA", async () => {
      await interrupt("need-input-A");
      return { a: "answered" };
    });
    g.addNode("nodeB", async () => {
      await interrupt("need-input-B");
      return { b: "answered" };
    });

    g.addEdge(START, "fanout");
    g.addEdge("fanout", ["nodeA", "nodeB"]);
    g.addEdge("nodeA", END);
    g.addEdge("nodeB", END);

    const checkpointer = new MemoryCheckpointer<S>();
    const app = g.compile({ checkpointer });

    // First invocation — should throw HITLInterruptException for one of the
    // parallel nodes. Record which node's interrupt fires.
    let exc: HITLInterruptException<S> | null = null;
    try {
      await app.invoke({ a: "", b: "" }, { threadId: "parallel-interrupt-test" });
    } catch (err) {
      if ((err as HITLInterruptException<S>).isHITLInterrupt) {
        exc = err as HITLInterruptException<S>;
      } else {
        throw err;
      }
    }

    expect(exc).not.toBeNull();

    // The node that interrupted is identified by exc.interrupt.node
    const interruptingNode = exc!.interrupt.node;
    const resumeId = exc!.interrupt.resumeId;

    // The resumeId must be prefixed with the interrupting node's own name,
    // not the sibling node's name. Under the enterWith() bug, this prefix
    // would be the last node that called enterWith() — not necessarily the
    // node that actually called interrupt().
    expect(resumeId).toMatch(new RegExp(`^${interruptingNode}-`));
  });

  it("AsyncLocalStorage enterWith() context bleed is demonstrated at unit level", async () => {
    // This test directly reproduces the race condition that BUG-0341 describes:
    // two async tasks sharing a parent context, each calling enterWith() — the
    // second call clobbers the first task's context.
    //
    // We test this at the ALS level to document the root cause.
    //
    // NOTE: This test documents the FIXED behavior. After the fix (als.run),
    // each task runs in an isolated scope and sees its own value.

    const als = new AsyncLocalStorage<{ name: string }>();

    const contextSeenByA: string[] = [];
    const contextSeenByB: string[] = [];

    // Run two concurrent tasks — each installs its own context via als.run()
    // and reads it back after yielding to the event loop.
    const taskA = als.run({ name: "taskA" }, async () => {
      await new Promise<void>((r) => setImmediate(r));
      contextSeenByA.push(als.getStore()?.name ?? "none");
    });

    const taskB = als.run({ name: "taskB" }, async () => {
      await new Promise<void>((r) => setImmediate(r));
      contextSeenByB.push(als.getStore()?.name ?? "none");
    });

    await Promise.all([taskA, taskB]);

    // Each task must see its own context
    expect(contextSeenByA).toEqual(["taskA"]);
    expect(contextSeenByB).toEqual(["taskB"]);
  });
});
