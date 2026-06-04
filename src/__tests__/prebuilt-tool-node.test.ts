import { describe, expect, it } from "vitest";
import { createToolNode, toolsCondition, type ONITool } from "../prebuilt/index.js";
import type { ONIMessage } from "../graph.js";

describe("prebuilt tool node", () => {
  it("returns no update when the last message has no tool calls", async () => {
    const node = createToolNode([]);

    await expect(node({ messages: [] }, {})).resolves.toEqual({});
    await expect(node({ messages: [{ role: "user", content: "hello" }] }, {})).resolves.toEqual({});
    await expect(node({ messages: [{ role: "assistant", content: "done" }] }, {})).resolves.toEqual({});
  });

  it("executes matching tool calls and serializes results as tool messages", async () => {
    const tools: ONITool[] = [
      {
        name: "sum",
        description: "Add numbers.",
        fn(args) {
          return { total: Number(args.a) + Number(args.b) };
        },
      },
      {
        name: "echo",
        description: "Echo text.",
        fn(args) {
          return String(args.text);
        },
      },
    ];
    const node = createToolNode(tools);
    const assistant: ONIMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call-1", name: "sum", args: { a: 2, b: 3 } },
        { id: "call-2", name: "echo", args: { text: "hi" } },
      ],
    };

    const update = await node({ messages: [assistant] }, {}) as { messages: ONIMessage[] };

    expect(update.messages).toEqual([
      {
        role: "tool",
        content: JSON.stringify({ total: 5 }),
        name: "sum",
        tool_call_id: "call-1",
      },
      {
        role: "tool",
        content: "hi",
        name: "echo",
        tool_call_id: "call-2",
      },
    ]);
  });

  it("turns missing and failing tools into tool error messages", async () => {
    const node = createToolNode([{
      name: "fail",
      description: "Throw.",
      fn() {
        throw new Error("boom");
      },
    }]);

    const update = await node({
      messages: [{
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "missing-1", name: "missing", args: {} },
          { id: "fail-1", name: "fail", args: {} },
        ],
      }],
    }, {}) as { messages: ONIMessage[] };

    expect(update.messages).toEqual([
      {
        role: "tool",
        content: 'Error: Tool "missing" not found.',
        name: "missing",
        tool_call_id: "missing-1",
      },
      {
        role: "tool",
        content: 'Error running tool "fail": boom',
        name: "fail",
        tool_call_id: "fail-1",
      },
    ]);
  });

  it("routes to tools only when the last assistant message has tool calls", () => {
    expect(toolsCondition({ messages: [] })).toBe("__end__");
    expect(toolsCondition({ messages: [{ role: "assistant", content: "done" }] })).toBe("__end__");
    expect(toolsCondition({
      messages: [{
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-1", name: "lookup", args: {} }],
      }],
    })).toBe("tools");
  });
});
