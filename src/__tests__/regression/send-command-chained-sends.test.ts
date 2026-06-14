import { describe, it, expect } from "vitest";
import { StateGraph, START, END, Send, Command, appendList, lastValue } from "../../../src/index.js";

// Regression test for BUG-5: Command.send from send-dispatched nodes is silently dropped.
//
// Root cause: the send-result-processing block (streaming.ts lines 148-154) handled
// result.update and result.goto inside the Command branch but never pushed result.send
// to nextSends. The main-node path (line 456) correctly does:
//   if (result.send) nextSends.push(...result.send.map((s) => ({ node: s.node, args: s.args })));
// Adding that same line to the send-dispatch Command branch is the fix.
//
// Load-bearing proof: revert the streaming.ts fix (remove the result.send line from the
// send-dispatch Command branch) → this test FAILS because the chained node never runs.
// With the fix → test passes.

describe("BUG-5 regression: Command.send from send-dispatched node", () => {
  it("chained Send inside Command returned by a send-dispatched node causes target node to execute", async () => {
    type S = { items: string[]; dispatched: string[]; chained: string[] };

    const g = new StateGraph<S>({
      channels: {
        items: lastValue(() => [] as string[]),
        dispatched: appendList(() => [] as string[]),
        chained: appendList(() => [] as string[]),
      },
    });

    // Router: fans out via Send — one Send per item
    g.addNode("router", async (_state) => {
      return {};
    });
    g.addConditionalEdges("router", (state) => {
      return state.items.map((item) => new Send("worker", { items: [item], dispatched: [], chained: [] }));
    });

    // Worker: dispatched via Send — returns Command({ send: [new Send("finisher", {...})] })
    // This is the affected path. Without the fix, the Send inside Command is dropped.
    g.addNode("worker", async (state) => {
      const item = state.items[0] ?? "unknown";
      return new Command({
        update: { dispatched: [`worker:${item}`] },
        send: [new Send("finisher", { items: state.items, dispatched: [], chained: [] })],
      });
    });

    // Finisher: only runs if the Command.send from worker is correctly processed
    const finisherRan: string[] = [];
    g.addNode("finisher", async (state) => {
      const item = state.items[0] ?? "unknown";
      finisherRan.push(item);
      return { chained: [`finisher:${item}`] };
    });

    g.addEdge(START, "router");
    g.addEdge("finisher", END);

    const app = g.compile();
    const result = await app.invoke({ items: ["A", "B"], dispatched: [], chained: [] });

    // dispatched[] proves workers ran (send-dispatch path, not the bug)
    expect(result.dispatched.sort()).toEqual(["worker:A", "worker:B"]);

    // chained[] and finisherRan prove the Command.send was processed.
    // Without the fix, finisher never runs → finisherRan is [] and result.chained is [].
    expect(finisherRan.sort()).toEqual(["A", "B"]);
    expect(result.chained.sort()).toEqual(["finisher:A", "finisher:B"]);
  });
});
