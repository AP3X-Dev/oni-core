import { describe, it, expect, vi, beforeEach } from "vitest";
import { openai } from "../models/openai.js";
import { openrouter } from "../models/openrouter.js";
import type { ChatChunk } from "../models/types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

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

function lastFetchBody(): Record<string, unknown> {
  const mock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [, init] = mock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

async function collectChunks(gen: AsyncGenerator<ChatChunk>): Promise<ChatChunk[]> {
  const chunks: ChatChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("OpenAI streaming usage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends stream_options.include_usage in request body", async () => {
    mockStreamResponse([
      `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}`,
      `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}`,
      `data: [DONE]`,
    ]);

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    // Consume the stream
    await collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] }));

    const body = lastFetchBody();
    expect(body["stream"]).toBe(true);
    expect(body["stream_options"]).toEqual({ include_usage: true });
  });

  it("emits usage chunk when API sends usage in final chunk", async () => {
    mockStreamResponse([
      `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
      `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}`,
      `data: [DONE]`,
    ]);

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const chunks = await collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] }));

    const usageChunks = chunks.filter((c) => c.type === "usage");
    expect(usageChunks.length).toBe(1);
    expect(usageChunks[0]!.usage).toEqual({
      inputTokens: 10,
      outputTokens: 3,
    });
  });
});

describe("OpenRouter streaming usage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends stream_options.include_usage in request body", async () => {
    mockStreamResponse([
      `data: {"id":"gen-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}`,
      `data: {"id":"gen-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}`,
      `data: [DONE]`,
    ]);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    await collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] }));

    const body = lastFetchBody();
    expect(body["stream"]).toBe(true);
    expect(body["stream_options"]).toEqual({ include_usage: true });
  });

  it("emits usage chunk when API sends usage in final chunk", async () => {
    mockStreamResponse([
      `data: {"id":"gen-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
      `data: {"id":"gen-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}`,
      `data: [DONE]`,
    ]);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    const chunks = await collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] }));

    const usageChunks = chunks.filter((c) => c.type === "usage");
    expect(usageChunks.length).toBe(1);
    expect(usageChunks[0]!.usage).toEqual({
      inputTokens: 8,
      outputTokens: 4,
    });
  });
});
