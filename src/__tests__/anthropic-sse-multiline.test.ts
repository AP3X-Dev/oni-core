import { describe, it, expect, vi, beforeEach } from "vitest";
import { anthropic } from "../models/anthropic.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Create a ReadableStream from raw SSE text */
function sseStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockSSEFetch(sseText: string): void {
  const response = {
    ok: true,
    status: 200,
    body: sseStream(sseText),
  } as unknown as Response;

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("anthropic SSE parser — multi-line data", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("concatenates multiple data: lines before emitting event", async () => {
    // Anthropic SSE where JSON is split across two data: lines
    // (e.g. a proxy or load balancer reformats the stream)
    const sseText = [
      "event: content_block_delta",
      'data: {"type":"content_block_delta",',
      'data: "index":0,"delta":{"type":"text_delta","text":"Hi"}}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
      "",
      "",
    ].join("\n");

    mockSSEFetch(sseText);

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-test" });
    const chunks: unknown[] = [];
    for await (const chunk of model.stream!({
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(chunk);
    }

    // Should get a text chunk — not a JSON parse error / dropped chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const textChunk = chunks.find(
      (c: unknown) => (c as Record<string, unknown>).type === "text",
    );
    expect(textChunk).toBeDefined();
    expect((textChunk as Record<string, string>).text).toBe("Hi");
  });
});
