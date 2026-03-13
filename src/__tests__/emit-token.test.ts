import { describe, it, expect } from "vitest";
import { StateGraph } from "../graph.js";
import { START, END, lastValue } from "../types.js";
import { emitToken } from "../streaming.js";

/* ------------------------------------------------------------------ */
/*  emitToken() — should produce message stream events                 */
/* ------------------------------------------------------------------ */

describe("emitToken()", () => {
  it("emits tokens that appear as 'messages' stream events", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("llm", async () => {
      emitToken("Hello");
      emitToken(" world");
      return { value: "done" };
    });
    g.addEdge(START, "llm");
    g.addEdge("llm", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: "messages" })) {
      events.push(evt);
    }

    // Should have "messages" events from the emitted tokens
    const messageEvents = events.filter((e) => e.event === "messages");
    expect(messageEvents.length).toBe(2);
    expect(messageEvents[0].data.chunk).toBe("Hello");
    expect(messageEvents[1].data.chunk).toBe(" world");
    expect(messageEvents[1].data.content).toBe("Hello world"); // accumulated
  });

  it("emits messages/complete event after node finishes", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("llm", async () => {
      emitToken("Hi");
      return { value: "done" };
    });
    g.addEdge(START, "llm");
    g.addEdge("llm", END);

    const app = g.compile();
    const events: any[] = [];
    for await (const evt of app.stream({ value: "" }, { streamMode: "messages" })) {
      events.push(evt);
    }

    const completeEvents = events.filter((e) => e.event === "messages/complete");
    expect(completeEvents.length).toBe(1);
    expect(completeEvents[0].data.content).toBe("Hi");
  });

  it("is a no-op when called outside node context (no crash)", () => {
    // Should not throw, just silently do nothing
    expect(() => emitToken("orphan")).not.toThrow();
  });
});
