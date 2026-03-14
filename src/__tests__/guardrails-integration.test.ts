import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";

describe("Guardrails integration", () => {
  it("compile accepts guardrails and listeners options", async () => {
    type S = { output: string };
    const g = new StateGraph<S>({
      channels: { output: lastValue(() => "") },
    });

    g.addNode("worker", async () => ({ output: "done" }));
    g.addEdge(START, "worker");
    g.addEdge("worker", END);

    const events: string[] = [];
    const app = g.compile({
      guardrails: {
        toolPermissions: { worker: ["allowed_tool"] },
        budget: { maxTokensPerRun: 100_000 },
        audit: true,
      },
      listeners: {
        "agent.start": (e) => events.push(`start:${e.agent}`),
        "agent.end": (e) => events.push(`end:${e.agent}`),
      },
    });

    const result = await app.invoke({});
    expect(result.output).toBe("done");
    expect(events).toContain("start:worker");
    expect(events).toContain("end:worker");
  });

  it("works without guardrails or listeners (backward compat)", async () => {
    type S = { val: number };
    const g = new StateGraph<S>({
      channels: { val: lastValue(() => 0) },
    });

    g.addNode("inc", async () => ({ val: 42 }));
    g.addEdge(START, "inc");
    g.addEdge("inc", END);

    const app = g.compile();
    const result = await app.invoke({});
    expect(result.val).toBe(42);
  });

  it("emits events for multiple nodes in sequence", async () => {
    type S = { count: number };
    const g = new StateGraph<S>({
      channels: { count: lastValue(() => 0) },
    });

    g.addNode("first", async () => ({ count: 1 }));
    g.addNode("second", async (s) => ({ count: s.count + 1 }));
    g.addEdge(START, "first");
    g.addEdge("first", "second");
    g.addEdge("second", END);

    const events: string[] = [];
    const app = g.compile({
      listeners: {
        "agent.start": (e) => events.push(`start:${e.agent}:step${e.step}`),
        "agent.end": (e) => events.push(`end:${e.agent}:step${e.step}`),
      },
    });

    const result = await app.invoke({});
    expect(result.count).toBe(2);
    expect(events).toEqual([
      "start:first:step0",
      "end:first:step0",
      "start:second:step1",
      "end:second:step1",
    ]);
  });
});
