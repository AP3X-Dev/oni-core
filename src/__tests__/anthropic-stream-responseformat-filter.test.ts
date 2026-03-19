import { describe, it, expect, vi, beforeEach } from "vitest";
import { anthropic } from "../models/anthropic.js";
import type { ChatChunk } from "../models/types.js";

function mockAnthropicStreamResponse(sseLines: string[]): void {
  const text = sseLines.join("\n") + "\n";
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: stream,
    text: async () => "",
  } as unknown as Response));
}

async function collectChunks(gen: AsyncGenerator<ChatChunk>): Promise<ChatChunk[]> {
  const chunks: ChatChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe("BUG-0234: Anthropic stream() suppresses synthetic responseFormat tool_use chunks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0234: should not emit tool_call_start/delta/end for the synthetic structured-output tool", async () => {
    // The Anthropic adapter implements json_schema responseFormat by injecting a
    // synthetic tool named after the schema. Before the fix, stream() would emit
    // tool_call_start, tool_call_delta, and tool_call_end chunks for this
    // internal tool — visible to callers who never declared it as a tool.
    const schemaName = "MyOutputSchema";

    mockAnthropicStreamResponse([
      `event: message_start`,
      `data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","usage":{"input_tokens":10,"output_tokens":0}}}`,
      ``,
      `event: content_block_start`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"${schemaName}","input":{}}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"answer\\":"}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"42\\"}"}}`,
      ``,
      `event: content_block_stop`,
      `data: {"type":"content_block_stop","index":0}`,
      ``,
      `event: message_delta`,
      `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":10,"output_tokens":5}}`,
      ``,
    ]);

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    const chunks = await collectChunks(
      model.stream({
        messages: [{ role: "user", content: "What is the answer?" }],
        responseFormat: {
          type: "json_schema",
          name: schemaName,
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
          },
        },
      }),
    );

    const toolChunkTypes = chunks
      .filter(c => c.type === "tool_call_start" || c.type === "tool_call_delta" || c.type === "tool_call_end")
      .map(c => c.type);

    // After the fix: no tool_call_* chunks emitted for the synthetic schema tool
    expect(toolChunkTypes).toHaveLength(0);
  });

  it("BUG-0234: should still emit tool_call_* chunks for real (non-synthetic) tools alongside responseFormat", async () => {
    const schemaName = "MyOutputSchema";

    mockAnthropicStreamResponse([
      `event: message_start`,
      `data: {"type":"message_start","message":{"id":"msg_02","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","usage":{"input_tokens":10,"output_tokens":0}}}`,
      ``,
      // Synthetic schema tool (index 0) — should be suppressed
      `event: content_block_start`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"${schemaName}","input":{}}}`,
      ``,
      `event: content_block_stop`,
      `data: {"type":"content_block_stop","index":0}`,
      ``,
      // Real tool call (index 1) — should pass through
      `event: content_block_start`,
      `data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_02","name":"get_weather","input":{}}}`,
      ``,
      `event: content_block_stop`,
      `data: {"type":"content_block_stop","index":1}`,
      ``,
      `event: message_delta`,
      `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":10,"output_tokens":5}}`,
      ``,
    ]);

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    const chunks = await collectChunks(
      model.stream({
        messages: [{ role: "user", content: "Get weather and return schema" }],
        responseFormat: {
          type: "json_schema",
          name: schemaName,
          schema: { type: "object", properties: {} },
        },
      }),
    );

    const toolStartChunks = chunks.filter(c => c.type === "tool_call_start");
    const toolEndChunks = chunks.filter(c => c.type === "tool_call_end");

    // Only the real tool (get_weather) should appear — not the synthetic schema tool
    expect(toolStartChunks).toHaveLength(1);
    expect(toolEndChunks).toHaveLength(1);
    const startChunk = toolStartChunks[0] as Extract<ChatChunk, { type: "tool_call_start" }>;
    expect(startChunk.toolCall.name).toBe("get_weather");
  });
});
