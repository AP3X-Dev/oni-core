import { describe, it, expect } from "vitest";
import { StreamWriterImpl } from "../streaming.js";
import type { CustomStreamEvent, MessageStreamEvent } from "../types.js";

describe("StreamWriterImpl", () => {
  it("emit() calls the custom event handler", () => {
    const events: CustomStreamEvent[] = [];
    const writer = new StreamWriterImpl(
      (evt) => events.push(evt),
      () => {},
      () => {},
      "testNode",
      0,
      "msg-test-0-testNode",
    );

    writer.emit("progress", { percent: 50 });
    writer.emit("status", { msg: "done" });

    expect(events).toHaveLength(2);
    expect(events[0]!.event).toBe("custom");
    expect(events[0]!.name).toBe("progress");
    expect(events[0]!.data).toEqual({ percent: 50 });
    expect(events[0]!.node).toBe("testNode");
    expect(events[1]!.name).toBe("status");
  });

  it("token() calls the token handler and accumulates", () => {
    const tokens: string[] = [];
    const messages: MessageStreamEvent[] = [];
    const writer = new StreamWriterImpl(
      () => {},
      (t) => tokens.push(t),
      (evt) => messages.push(evt),
      "testNode",
      0,
      "msg-test-0-testNode",
    );

    writer.token("Hello");
    writer.token(" world");

    expect(tokens).toEqual(["Hello", " world"]);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.event).toBe("messages");
    expect(messages[0]!.data.chunk).toBe("Hello");
    expect(messages[0]!.data.content).toBe("Hello");
    expect(messages[1]!.data.chunk).toBe(" world");
    expect(messages[1]!.data.content).toBe("Hello world");
  });

  it("_complete() returns messages/complete event", () => {
    const writer = new StreamWriterImpl(
      () => {},
      () => {},
      () => {},
      "testNode",
      0,
      "msg-test-0-testNode",
    );

    writer.token("Hi");
    const complete = writer._complete();

    expect(complete).not.toBeNull();
    expect(complete!.event).toBe("messages/complete");
    expect(complete!.data.content).toBe("Hi");
    expect(complete!.data.chunk).toBe("");
    expect(complete!.data.role).toBe("assistant");
    expect(complete!.data.id).toBe("msg-test-0-testNode");
  });

  it("_complete() returns null when no tokens emitted", () => {
    const writer = new StreamWriterImpl(
      () => {},
      () => {},
      () => {},
      "testNode",
      0,
      "msg-test-0-testNode",
    );

    expect(writer._complete()).toBeNull();
  });
});
