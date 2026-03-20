import { describe, it, expect, vi, beforeEach } from "vitest";
import { anthropic } from "../models/anthropic.js";

/**
 * Regression test for BUG-0265: anthropic.ts chat() returned stopReason "tool_use"
 * even when all tool_use blocks were synthetic (from responseFormat json_schema mode).
 *
 * Fix: when stopReason is "tool_use" but toolCalls is empty and rfName is set,
 * override stopReason to "end".
 *
 * Without the fix, the agent harness sees "tool_use" and enters tool-dispatch
 * logic for a response that has no real tool calls, causing incorrect behavior.
 */

function mockAnthropicChatResponse(body: Record<string, unknown>): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response));
}

describe("BUG-0265: anthropic chat() stopReason override for synthetic structured-output blocks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0265: returns stopReason 'end' when only the synthetic responseFormat tool_use block is present", async () => {
    // Simulate Anthropic API response for json_schema structured output:
    // - stop_reason is "tool_use" (Anthropic always returns this when a tool_use block is present)
    // - content contains only the synthetic tool_use block for the schema (named "MySchema")
    // - no real tool calls exist
    mockAnthropicChatResponse({
      id: "msg_01",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "MySchema",
          input: { answer: 42 },
        },
      ],
      model: "claude-sonnet-4-20250514",
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    const response = await model.chat({
      messages: [{ role: "user", content: "What is 6 * 7?" }],
      maxTokens: 256,
      responseFormat: {
        type: "json_schema",
        name: "MySchema",
        schema: {
          type: "object",
          properties: { answer: { type: "number" } },
          required: ["answer"],
        },
      },
    });

    // After the fix: stopReason must be "end", not "tool_use"
    expect(response.stopReason).toBe("end");
    // The parsed field should contain the structured output
    expect(response.parsed).toEqual({ answer: 42 });
    // No real tool calls should be exposed
    expect(response.toolCalls).toBeUndefined();
  });

  it("BUG-0265: preserves stopReason 'tool_use' when real tool calls are present alongside responseFormat", async () => {
    // When a real tool call co-exists with the synthetic schema block,
    // stopReason should remain "tool_use" so the harness dispatches the real tool.
    mockAnthropicChatResponse({
      id: "msg_02",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "MySchema",
          input: { result: "test" },
        },
        {
          type: "tool_use",
          id: "toolu_02",
          name: "get_weather",
          input: { city: "London" },
        },
      ],
      model: "claude-sonnet-4-20250514",
      stop_reason: "tool_use",
      usage: { input_tokens: 15, output_tokens: 8 },
    });

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    const response = await model.chat({
      messages: [{ role: "user", content: "Get weather and return schema" }],
      maxTokens: 256,
      responseFormat: {
        type: "json_schema",
        name: "MySchema",
        schema: { type: "object", properties: {} },
      },
    });

    // Real tool call present — stopReason must stay "tool_use"
    expect(response.stopReason).toBe("tool_use");
    // Only real tool calls exposed (synthetic filtered out)
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe("get_weather");
  });

  it("BUG-0265: does not affect stopReason when responseFormat is not set", async () => {
    // Baseline: without responseFormat, stop_reason "tool_use" maps to "tool_use"
    mockAnthropicChatResponse({
      id: "msg_03",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "search",
          input: { query: "test" },
        },
      ],
      model: "claude-sonnet-4-20250514",
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    const response = await model.chat({
      messages: [{ role: "user", content: "Search something" }],
      maxTokens: 256,
    });

    // No responseFormat — stopReason stays "tool_use" as normal
    expect(response.stopReason).toBe("tool_use");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe("search");
  });
});
