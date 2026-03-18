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

describe("BUG-0226: Anthropic streaming emits tool_call_end with assembled args", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0226: should emit tool_call_end on content_block_stop for tool_use blocks", async () => {
    // Before the fix, the Anthropic adapter emitted tool_call_start and
    // tool_call_delta but never tool_call_end, silently dropping all tool calls
    // for streaming consumers that commit on tool_call_end.
    mockAnthropicStreamResponse([
      `event: message_start`,
      `data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","usage":{"input_tokens":10,"output_tokens":0}}}`,
      ``,
      `event: content_block_start`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_weather","input":{}}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"Paris\\"}"}}`,
      ``,
      `event: content_block_stop`,
      `data: {"type":"content_block_stop","index":0}`,
      ``,
      `event: message_delta`,
      `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":10,"output_tokens":5}}`,
      ``,
    ]);

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    const chunks = await collectChunks(model.stream({
      messages: [{ role: "user", content: "Weather in Paris?" }],
    }));

    const endChunks = chunks.filter((c) => c.type === "tool_call_end");
    expect(endChunks).toHaveLength(1);
    expect(endChunks[0]!.toolCall).toEqual({
      id: "toolu_01",
      name: "get_weather",
      args: { city: "Paris" },
    });
  });
});
