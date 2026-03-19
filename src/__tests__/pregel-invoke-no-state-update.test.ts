import { describe, it, expect } from "vitest";
import { StateGraph } from "../graph.js";
import { START, END, lastValue } from "../types.js";
import type { ONIPregelRunner } from "../pregel/index.js";

describe("Pregel.invoke() — no state_update safety", () => {
  it("BUG-0034: should throw when stream yields no state_update events instead of returning undefined", async () => {
    // Before the fix: `let finalState!: S` with no fallback caused invoke() to return
    // undefined typed as S, silently violating the Promise<S> contract.
    // After BUG-0050's improvement: invoke() throws descriptively when no state_update fires.
    type S = { value: number };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => 0) } });
    g.addNode("noop", (s) => s);
    g.addEdge(START, "noop");
    g.addEdge("noop", END);
    const app = g.compile();

    // Access the underlying Pregel runner via the internal _runner property
    const runner = (app as unknown as { _runner: ONIPregelRunner<S> })._runner;

    // Patch _stream on the runner to produce zero events
    const original = runner._stream.bind(runner);
    runner._stream = async function* () {
      // yield nothing — no state_update events
    };

    try {
      await expect(app.invoke({ value: 42 })).rejects.toThrow(
        "Graph execution produced no state updates",
      );
    } finally {
      runner._stream = original;
    }
  });
});
