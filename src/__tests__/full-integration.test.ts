import { describe, it, expect } from "vitest";
import {
  StateGraph, START, END, lastValue,
} from "../index.js";
import { getConfig, getStore, getStreamWriter } from "../context.js";
import { InMemoryStore } from "../store/index.js";

describe("full integration", () => {
  it("all context accessors work together in one graph", async () => {
    type S = {
      configThread:  string;
      storeValue:    string;
      writerWorked:  boolean;
    };

    const store = new InMemoryStore();
    await store.put(["data"], "key", "hello");

    const g = new StateGraph<S>({
      channels: {
        configThread: lastValue(() => ""),
        storeValue:   lastValue(() => ""),
        writerWorked: lastValue(() => false),
      },
    });

    g.addNode("all_in_one", async () => {
      const cfg = getConfig();
      const s   = getStore();
      const w   = getStreamWriter();

      const item = await s!.get<string>(["data"], "key");
      w!.emit("started", {});
      w!.token("t");

      return {
        configThread: cfg.threadId ?? "none",
        storeValue:   item?.value ?? "missing",
        writerWorked: true,
      };
    });

    g.addEdge(START, "all_in_one");
    g.addEdge("all_in_one", END);

    const app = g.compile({ store });
    const res = await app.invoke(
      { configThread: "", storeValue: "", writerWorked: false },
      { threadId: "integration-1" },
    );

    expect(res.configThread).toBe("integration-1");
    expect(res.storeValue).toBe("hello");
    expect(res.writerWorked).toBe(true);
  });

  it("all stream modes produce correct event types", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("worker", async () => {
      const w = getStreamWriter();
      w!.token("tok");
      w!.emit("evt", { x: 1 });
      return { value: "done" };
    });
    g.addEdge(START, "worker");
    g.addEdge("worker", END);
    const app = g.compile();

    // values mode — only state_update events
    const valEvents: any[] = [];
    for await (const e of app.stream({ value: "" }, { streamMode: "values" })) {
      valEvents.push(e);
    }
    expect(valEvents.every((e) => e.event === "state_update")).toBe(true);

    // custom mode — only custom events
    const customEvents: any[] = [];
    for await (const e of app.stream({ value: "" }, { streamMode: "custom" })) {
      customEvents.push(e);
    }
    expect(customEvents.some((e) => e.event === "custom")).toBe(true);
    expect(customEvents.every((e) => e.event !== "messages")).toBe(true);

    // messages mode — only message events
    const msgEvents: any[] = [];
    for await (const e of app.stream({ value: "" }, { streamMode: "messages" })) {
      msgEvents.push(e);
    }
    expect(msgEvents.some((e) => e.event === "messages")).toBe(true);
    expect(msgEvents.every((e) => e.event !== "custom")).toBe(true);
  });
});
