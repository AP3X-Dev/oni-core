import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";
import { getStreamWriter } from "../context.js";

describe("messages stream mode", () => {
  it("yields MessageStreamEvent for each token", async () => {
    type S = { response: string };
    const g = new StateGraph<S>({
      channels: { response: lastValue(() => "") },
    });

    g.addNode("llm", async () => {
      const writer = getStreamWriter();
      writer!.token("Hello");
      writer!.token(" world");
      return { response: "Hello world" };
    });
    g.addEdge(START, "llm");
    g.addEdge("llm", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of app.stream({ response: "" }, { streamMode: "messages" })) {
      events.push(evt);
    }

    const msgs = events.filter((e) => e.event === "messages");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].data.chunk).toBe("Hello");
    expect(msgs[0].data.content).toBe("Hello");
    expect(msgs[0].data.role).toBe("assistant");
    expect(msgs[1].data.chunk).toBe(" world");
    expect(msgs[1].data.content).toBe("Hello world");
  });

  it("emits messages/complete when node finishes", async () => {
    type S = { response: string };
    const g = new StateGraph<S>({
      channels: { response: lastValue(() => "") },
    });

    g.addNode("llm", async () => {
      const writer = getStreamWriter();
      writer!.token("Hi");
      return { response: "Hi" };
    });
    g.addEdge(START, "llm");
    g.addEdge("llm", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of app.stream({ response: "" }, { streamMode: "messages" })) {
      events.push(evt);
    }

    const complete = events.filter((e) => e.event === "messages/complete");
    expect(complete).toHaveLength(1);
    expect(complete[0].data.content).toBe("Hi");
    expect(complete[0].node).toBe("llm");
  });

  it("generates stable message IDs", async () => {
    type S = { response: string };
    const g = new StateGraph<S>({
      channels: { response: lastValue(() => "") },
    });

    g.addNode("llm", async () => {
      const writer = getStreamWriter();
      writer!.token("a");
      writer!.token("b");
      return { response: "ab" };
    });
    g.addEdge(START, "llm");
    g.addEdge("llm", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of app.stream(
      { response: "" },
      { threadId: "t1", streamMode: "messages" },
    )) {
      events.push(evt);
    }

    const msgs = events.filter((e) => e.event === "messages");
    // Same ID for both chunks (same node invocation)
    expect(msgs[0].data.id).toBe(msgs[1].data.id);
    expect(msgs[0].data.id).toContain("t1");
    expect(msgs[0].data.id).toContain("llm");
  });

  it("token events are ignored in updates mode", async () => {
    type S = { response: string };
    const g = new StateGraph<S>({
      channels: { response: lastValue(() => "") },
    });

    g.addNode("llm", async () => {
      const writer = getStreamWriter();
      writer!.token("Hi");
      return { response: "Hi" };
    });
    g.addEdge(START, "llm");
    g.addEdge("llm", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of app.stream({ response: "" }, { streamMode: "updates" })) {
      events.push(evt);
    }

    const msgs = events.filter(
      (e) => e.event === "messages" || e.event === "messages/complete",
    );
    expect(msgs).toHaveLength(0);
  });
});
