import { describe, it, expect, vi, beforeEach } from "vitest";
import { openai } from "../models/openai.js";
import type { ChatChunk } from "../models/types.js";

// BUG-0044 regression: OpenAI streaming guard `(!choices || choices.length === 0)` was missing
// `&& !parsed["usage"]`, so usage-only final chunks were skipped entirely.
// This caused all streaming OpenAI calls to report 0 input/output tokens.

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

describe("OpenAI stream() BUG-0044: usage-only final chunk is not skipped", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0044: yields usage from a chunk with no choices and populated usage field", async () => {
    // OpenAI sends a final chunk with empty choices[] and populated usage when
    // stream_options.include_usage is set. Pre-fix code skipped this chunk entirely.
    mockStreamResponse([
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })}`,
      "data: [DONE]",
    ]);

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "hi" }] }),
    );

    const usageChunks = chunks.filter((c) => c.type === "usage");
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0]).toEqual({
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 3 },
    });
  });

  it("BUG-0044: usage chunk with null choices also surfaces token counts", async () => {
    // Some versions of the response omit choices entirely on the usage chunk.
    mockStreamResponse([
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } })}`,
      "data: [DONE]",
    ]);

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "hi" }] }),
    );

    const usageChunks = chunks.filter((c) => c.type === "usage");
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0]).toMatchObject({
      type: "usage",
      usage: { inputTokens: 5, outputTokens: 1 },
    });
  });
});
