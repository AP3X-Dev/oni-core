import { describe, it, expect, vi, beforeEach } from "vitest";
import { openrouter } from "../models/openrouter.js";
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

describe("BUG-0178: OpenRouter stream emits usage from usage-only chunks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0178: should yield usage from a chunk with empty choices and populated usage", async () => {
    // Some providers send a final usage-only SSE chunk after the stop chunk.
    // Before the fix, the guard `if (!choices || choices.length === 0) continue`
    // skipped this chunk entirely, dropping token usage data.
    mockStreamResponse([
      `data: {"id":"gen-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}`,
      `data: {"id":"gen-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      `data: {"id":"gen-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}`,
      `data: [DONE]`,
    ]);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    const chunks = await collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] }));

    const usageChunks = chunks.filter((c) => c.type === "usage");
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0]!.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
    });
  });
});
