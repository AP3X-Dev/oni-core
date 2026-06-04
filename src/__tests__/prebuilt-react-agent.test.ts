import { describe, expect, it, vi } from "vitest";
import { createReactAgent, type ONILanguageModel } from "../prebuilt/index.js";
import type { ONIModel } from "../models/types.js";

function makeModel(): ONIModel {
  return {
    provider: "test",
    modelId: "react-test",
    capabilities: {
      tools: true,
      vision: false,
      streaming: false,
      embeddings: false,
    },
    chat: vi
      .fn()
      .mockResolvedValueOnce({
        content: "I will call a tool.",
        toolCalls: [{ id: "call-1", name: "lookup", args: { query: "oni" } }],
        usage: { inputTokens: 5, outputTokens: 3 },
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: "The lookup says ONI is ready.",
        usage: { inputTokens: 8, outputTokens: 6 },
        stopReason: "end",
      }),
    async *stream() {
      // not used by createReactAgent
    },
  };
}

describe("createReactAgent", () => {
  it("adapts ONIModel tool calls through the ReAct graph loop", async () => {
    const model = makeModel();
    const app = createReactAgent({
      llm: model,
      systemPrompt: "Use tools when useful.",
      tools: [
        {
          name: "lookup",
          description: "Lookup a topic.",
          schema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          fn(args) {
            return `result:${String(args.query)}`;
          },
        },
      ],
    });

    const result = await app.invoke({
      messages: [{ role: "user", content: "What is ONI?" }],
    }, { threadId: "react-loop" });

    expect(model.chat).toHaveBeenCalledTimes(2);
    expect(model.chat).toHaveBeenNthCalledWith(1, expect.objectContaining({
      messages: [
        { role: "system", content: "Use tools when useful.", toolCalls: undefined, toolCallId: undefined },
        { role: "user", content: "What is ONI?", toolCalls: undefined, toolCallId: undefined },
      ],
      tools: [{
        name: "lookup",
        description: "Lookup a topic.",
        parameters: expect.objectContaining({ type: "object" }),
      }],
    }));
    expect(model.chat).toHaveBeenNthCalledWith(2, expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: "result:oni",
          toolCallId: "call-1",
        }),
      ]),
    }));
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "The lookup says ONI is ready.",
    });
  });

  it("supports legacy invoke-only models without tools", async () => {
    const legacy: ONILanguageModel = {
      invoke: vi.fn().mockResolvedValue({
        role: "assistant",
        content: "legacy complete",
      }),
    };
    const app = createReactAgent({ llm: legacy });

    const result = await app.invoke({
      messages: [{ role: "user", content: "hello" }],
    });

    expect(legacy.invoke).toHaveBeenCalledWith([
      { role: "user", content: "hello" },
    ], {
      tools: undefined,
      signal: undefined,
    });
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "legacy complete",
    });
  });
});
