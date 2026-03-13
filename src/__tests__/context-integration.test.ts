import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";
import { getConfig, getStore } from "../context.js";
import { InMemoryStore } from "../store/index.js";

describe("context integration", () => {
  it("getConfig() returns config inside a graph node", async () => {
    type S = { result: string };
    const g = new StateGraph<S>({
      channels: { result: lastValue(() => "") },
    });

    g.addNode("capture", async () => {
      const cfg = getConfig();
      return { result: cfg.threadId ?? "no-thread" };
    });
    g.addEdge(START, "capture");
    g.addEdge("capture", END);

    const app = g.compile();
    const res = await app.invoke({ result: "" }, { threadId: "test-123" });
    expect(res.result).toBe("test-123");
  });

  it("getStore() returns the compiled store", async () => {
    type S = { found: boolean };
    const store = new InMemoryStore();
    await store.put(["test"], "key", "value");

    const g = new StateGraph<S>({
      channels: { found: lastValue(() => false) },
    });

    g.addNode("check", async () => {
      const s = getStore();
      const item = await s!.get(["test"], "key");
      return { found: item !== null };
    });
    g.addEdge(START, "check");
    g.addEdge("check", END);

    const app = g.compile({ store });
    const res = await app.invoke({ found: false });
    expect(res.found).toBe(true);
  });

  it("getStore() returns null when no store compiled", async () => {
    type S = { storeIsNull: boolean };
    const g = new StateGraph<S>({
      channels: { storeIsNull: lastValue(() => false) },
    });

    g.addNode("check", async () => {
      return { storeIsNull: getStore() === null };
    });
    g.addEdge(START, "check");
    g.addEdge("check", END);

    const app = g.compile();
    const res = await app.invoke({ storeIsNull: false });
    expect(res.storeIsNull).toBe(true);
  });
});
