import { describe, it, expect, vi, beforeEach } from "vitest";
import { openai } from "../models/openai.js";
import type { ChatChunk } from "../models/types.js";

function mockStreamResponse(sseLines: string[]): void {
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

describe("BUG-0044: OpenAI stream emits usage from usage-only final chunk", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0044: should yield usage from a chunk with empty choices and populated usage", async () => {
    // OpenAI sends a final usage-only chunk (empty choices, populated usage)
    // when stream_options.include_usage is set. Before the fix, the guard
    // `if (!choices || choices.length === 0) continue` skipped this chunk,
    // making the usage yield dead code — token accounting always reported 0.
    mockStreamResponse([
      `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}`,
      `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}}`,
      `data: [DONE]`,
    ]);

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const chunks = await collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] }));

    const usageChunks = chunks.filter((c) => c.type === "usage");
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0]!.usage).toEqual({
      inputTokens: 8,
      outputTokens: 3,
    });
  });
});
