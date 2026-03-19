import { describe, it, expect } from "vitest";
import { StateGraph } from "../graph.js";
import { START, END, lastValue } from "../types.js";
import { ONIInterrupt } from "../errors.js";
import { MemoryCheckpointer } from "../checkpoint.js";

describe("Pregel interruptAfter — parallel node completeness (BUG-0055)", () => {
  it("BUG-0055: interruptAfter preserves all parallel nodes' state updates before throwing", async () => {
    // Before the fix: interruptAfter check fired inside the per-result loop, so nodes
    // processed AFTER the interrupting node had their state updates silently discarded.
    // After the fix: the interrupt check runs in a separate post-loop pass, ensuring all
    // parallel node results are applied before ONIInterrupt is thrown.

    type S = { a: string; b: string };
    const g = new StateGraph<S>({
      channels: {
        a: lastValue(() => ""),
        b: lastValue(() => ""),
      },
    });

    // fan-in node that fans out to nodeA and nodeB in parallel
    g.addNode("init", async () => ({}));
    g.addNode("nodeA", async () => ({ a: "from-A" }));
    g.addNode("nodeB", async () => ({ b: "from-B" }));

    g.addEdge(START, "init");
    g.addEdge("init", ["nodeA", "nodeB"]);
    g.addEdge("nodeA", END);
    g.addEdge("nodeB", END);

    const cp = new MemoryCheckpointer<S>();
    const app = g.compile({
      checkpointer: cp,
      interruptAfter: ["nodeA"],
    });

    let thrownInterrupt: ONIInterrupt<S> | null = null;
    try {
      await app.invoke({ a: "", b: "" }, { threadId: "bug-0055-test" });
    } catch (err) {
      if (err instanceof ONIInterrupt) {
        thrownInterrupt = err as ONIInterrupt<S>;
      } else {
        throw err;
      }
    }

    expect(thrownInterrupt).not.toBeNull();
    expect(thrownInterrupt!.isONIInterrupt).toBe(true);

    // Both nodeA and nodeB run in the same parallel batch.
    // The interrupt fires after nodeA, but nodeB's state update must NOT be lost.
    expect(thrownInterrupt!.state.a).toBe("from-A");
    expect(thrownInterrupt!.state.b).toBe("from-B"); // Would be "" under the pre-fix bug
  });
});
