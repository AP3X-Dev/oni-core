import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";
import { NodeTimeoutError } from "../errors.js";

describe("node timeouts", () => {
  it("node completes within timeout — no error", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("fast", async () => ({ value: "done" }), { timeout: 5000 });
    g.addEdge(START, "fast");
    g.addEdge("fast", END);
    const app = g.compile();
    const result = await app.invoke({ value: "hi" });
    expect(result.value).toBe("done");
  });

  it("node exceeding timeout throws NodeTimeoutError", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("slow", async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return { value: "done" };
    }, { timeout: 50 });
    g.addEdge(START, "slow");
    g.addEdge("slow", END);
    const app = g.compile();
    await expect(app.invoke({ value: "hi" })).rejects.toThrow(NodeTimeoutError);
  });

  it("global default timeout applies", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("slow", async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return { value: "done" };
    });
    g.addEdge(START, "slow");
    g.addEdge("slow", END);
    const app = g.compile({ defaults: { nodeTimeout: 50 } });
    await expect(app.invoke({ value: "hi" })).rejects.toThrow(NodeTimeoutError);
  });

  it("per-node timeout overrides global default", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("fast", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { value: "done" };
    }, { timeout: 5000 });
    g.addEdge(START, "fast");
    g.addEdge("fast", END);
    const app = g.compile({ defaults: { nodeTimeout: 1 } });
    const result = await app.invoke({ value: "hi" });
    expect(result.value).toBe("done");
  });
});
