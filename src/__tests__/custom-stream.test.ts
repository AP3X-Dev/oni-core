import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";
import { getStreamWriter } from "../context.js";
import { emitToken } from "../streaming.js";

describe("custom stream mode", () => {
  it("yields custom events when streamMode is 'custom'", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("worker", async () => {
      const writer = getStreamWriter();
      writer!.emit("progress", { percent: 50 });
      writer!.emit("progress", { percent: 100 });
      return { value: "done" };
    });
    g.addEdge(START, "worker");
    g.addEdge("worker", END);

    const app = g.compile();
    const events: unknown[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: "custom" })) {
      events.push(evt);
    }

    const customs = events.filter((e: any) => e.event === "custom");
    expect(customs).toHaveLength(2);
    expect((customs[0] as any).name).toBe("progress");
    expect((customs[0] as any).data).toEqual({ percent: 50 });
    expect((customs[0] as any).node).toBe("worker");
  });

  it("custom events are hidden in 'updates' mode", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("worker", async () => {
      const writer = getStreamWriter();
      writer!.emit("custom_thing", { x: 1 });
      return { value: "done" };
    });
    g.addEdge(START, "worker");
    g.addEdge("worker", END);

    const app = g.compile();
    const events: unknown[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: "updates" })) {
      events.push(evt);
    }

    const customs = events.filter((e: any) => e.event === "custom");
    expect(customs).toHaveLength(0);
  });

  it("custom events appear in 'debug' mode", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("worker", async () => {
      const writer = getStreamWriter();
      writer!.emit("info", { msg: "hi" });
      return { value: "done" };
    });
    g.addEdge(START, "worker");
    g.addEdge("worker", END);

    const app = g.compile();
    const events: unknown[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: "debug" })) {
      events.push(evt);
    }

    const customs = events.filter((e: any) => e.event === "custom");
    expect(customs).toHaveLength(1);
    expect((customs[0] as any).name).toBe("info");
  });

  it("emitToken backward compat still works", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("llm", async () => {
      emitToken("hello");
      return { value: "done" };
    });
    g.addEdge(START, "llm");
    g.addEdge("llm", END);

    const app = g.compile();
    const result = await app.invoke({ value: "" });
    expect(result.value).toBe("done");
  });
});
