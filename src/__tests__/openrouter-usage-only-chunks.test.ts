import { describe, it, expect, vi, beforeEach } from "vitest";
import { openrouter } from "../models/openrouter.js";
import type { ChatChunk } from "../models/types.js";

function mockStreamResponse(sseLines: string[], status = 200): void {
  const text = sseLines.join("\n") + "\n";
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });

  const response = {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    text: async () => "",
  } as unknown as Response;

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

async function collectChunks(gen: AsyncGenerator<ChatChunk>): Promise<ChatChunk[]> {
  const chunks: ChatChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("OpenRouter stream()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0178: yields usage from usage-only SSE chunks with empty choices", async () => {
    // Simulate an OpenRouter stream where the final chunk has empty choices
    // but populated usage — the pre-fix code skipped these entirely.
    mockStreamResponse([
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } })}`,
      "data: [DONE]",
    ]);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "hello" }] }),
    );

    const usageChunks = chunks.filter((c) => c.type === "usage");
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0]).toEqual({
      type: "usage",
      usage: { inputTokens: 42, outputTokens: 7 },
    });
  });
});
