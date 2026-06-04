import { describe, expect, it } from "vitest";
import {
  RemoveMessage,
  UpdateMessage,
  aiMessage,
  filterByRole,
  getMessageById,
  humanMessage,
  messagesChannel,
  messagesReducer,
  messagesStateChannels,
  systemMessage,
  toolMessage,
  trimMessages,
  type Message,
} from "../messages/index.js";

describe("messages reducer", () => {
  it("appends messages, generates ids, and overwrites duplicate ids", () => {
    const first = messagesReducer([], { role: "user", content: "hello" });
    expect(first).toHaveLength(1);
    expect(first[0]!.id).toMatch(/^msg-/);

    const overwritten = messagesReducer(first, {
      id: first[0]!.id,
      role: "assistant",
      content: "replacement",
    });

    expect(overwritten).toHaveLength(1);
    expect(overwritten[0]).toEqual({
      id: first[0]!.id,
      role: "assistant",
      content: "replacement",
    });
  });

  it("applies remove and update control messages without storing controls", () => {
    const current: Message[] = [
      humanMessage("keep", "u1"),
      aiMessage("old", { id: "a1" }),
      toolMessage("tool", "call-1", "t1"),
    ];

    const next = messagesReducer(current, [
      new UpdateMessage("a1", { content: "new", metadata: { reviewed: true } }),
      new RemoveMessage("t1"),
      new UpdateMessage("missing", { content: "ignored" }),
    ]);

    expect(next).toEqual([
      humanMessage("keep", "u1"),
      {
        id: "a1",
        role: "assistant",
        content: "new",
        metadata: { reviewed: true },
      },
    ]);
  });

  it("exposes a channel reducer and default state", () => {
    const channel = messagesChannel();
    const initial = channel.default();
    const reduced = channel.reducer(initial, [
      systemMessage("rules", "s1"),
      humanMessage("question", "u1"),
    ]);

    expect(initial).toEqual([]);
    expect(reduced).toEqual([
      systemMessage("rules", "s1"),
      humanMessage("question", "u1"),
    ]);
    expect(messagesStateChannels.messages.default()).toEqual([]);
  });

  it("creates typed helper messages and finds messages by id or role", () => {
    const toolCalls = [{ id: "call-1", name: "search", args: { q: "oni" } }];
    const messages = [
      systemMessage("system", "s1"),
      humanMessage("hello", "u1"),
      aiMessage("use tool", { id: "a1", tool_calls: toolCalls }),
      toolMessage("result", "call-1", "t1"),
    ];

    expect(getMessageById(messages, "a1")?.tool_calls).toEqual(toolCalls);
    expect(getMessageById(messages, "missing")).toBeUndefined();
    expect(filterByRole(messages, "assistant")).toEqual([messages[2]]);
    expect(filterByRole(messages, "tool")).toEqual([messages[3]]);
  });

  it("trims to recent non-system messages and drops leading orphan tool results", () => {
    const messages = [
      systemMessage("system", "s1"),
      humanMessage("first", "u1"),
      aiMessage("tool call", { id: "a1", tool_calls: [{ id: "call-1", name: "lookup", args: {} }] }),
      toolMessage("orphan if sliced", "call-1", "t1"),
      humanMessage("second", "u2"),
      aiMessage("answer", { id: "a2" }),
    ];

    expect(trimMessages(messages, 3)).toEqual([
      systemMessage("system", "s1"),
      humanMessage("second", "u2"),
      aiMessage("answer", { id: "a2" }),
    ]);
  });
});
