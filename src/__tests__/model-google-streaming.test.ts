import { describe, it, expect, vi, beforeEach } from "vitest";
import { google } from "../models/google.js";
import type { ChatChunk } from "../models/types.js";
import { ModelAPIError, ModelRateLimitError } from "../errors.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Build a Gemini SSE line from a GeminiResponseBody-like object */
function sseData(body: unknown): string {
  return `data: ${JSON.stringify(body)}`;
}

/** Gemini response with text part */
function textChunk(text: string, usage?: { prompt: number; candidates: number }) {
  const body: Record<string, unknown> = {
    candidates: [
      { content: { parts: [{ text }], role: "model" } },
    ],
  };
  if (usage) {
    body["usageMetadata"] = {
      promptTokenCount: usage.prompt,
      candidatesTokenCount: usage.candidates,
    };
  }
  return body;
}

/** Gemini response with functionCall part */
function toolCallChunk(
  name: string,
  args: Record<string, unknown>,
  usage?: { prompt: number; candidates: number },
) {
  const body: Record<string, unknown> = {
    candidates: [
      {
        content: {
          parts: [{ functionCall: { name, args } }],
          role: "model",
        },
      },
    ],
  };
  if (usage) {
    body["usageMetadata"] = {
      promptTokenCount: usage.prompt,
      candidatesTokenCount: usage.candidates,
    };
  }
  return body;
}

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

function mockErrorResponse(status: number, body = ""): void {
  const response = {
    ok: false,
    status,
    text: async () => body,
    body: null,
  } as unknown as Response;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

function mockNoBodyResponse(): void {
  const response = {
    ok: true,
    status: 200,
    body: null,
    text: async () => "",
  } as unknown as Response;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

function lastFetchUrl(): string {
  const mock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [url] = mock.mock.calls[0] as [string, RequestInit];
  return url;
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

describe("google gemini streaming", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Request format ────────────────────────────────────────────

  it("sends to streamGenerateContent?alt=sse endpoint", async () => {
    mockStreamResponse([
      sseData(textChunk("Hi")),
      "data: [DONE]",
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    await collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] }));

    expect(lastFetchUrl()).toContain("gemini-2.0-flash:streamGenerateContent?alt=sse");
  });

  // ── Text streaming ────────────────────────────────────────────

  it("yields text chunks from streamed SSE data", async () => {
    mockStreamResponse([
      sseData(textChunk("Hello")),
      sseData(textChunk(" world")),
      "data: [DONE]",
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "Hi" }] }),
    );

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.length).toBe(2);
    expect(textChunks[0]!.text).toBe("Hello");
    expect(textChunks[1]!.text).toBe(" world");
  });

  // ── Tool call streaming ───────────────────────────────────────

  it("yields tool_call_start + tool_call_end for function calls", async () => {
    mockStreamResponse([
      sseData(toolCallChunk("get_weather", { location: "London" })),
      "data: [DONE]",
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "Weather?" }] }),
    );

    const starts = chunks.filter((c) => c.type === "tool_call_start");
    const ends = chunks.filter((c) => c.type === "tool_call_end");

    expect(starts.length).toBe(1);
    expect(ends.length).toBe(1);
    expect(starts[0]!.toolCall!.name).toBe("get_weather");
    expect(starts[0]!.toolCall!.args).toEqual({ location: "London" });

    // start and end share the same ID
    expect(starts[0]!.toolCall!.id).toBe(ends[0]!.toolCall!.id);
    expect(starts[0]!.toolCall!.id).toMatch(/^call_stream_/);
  });

  it("yields unique IDs for multiple tool calls in stream", async () => {
    mockStreamResponse([
      sseData({
        candidates: [{
          content: {
            parts: [
              { functionCall: { name: "search", args: { q: "a" } } },
              { functionCall: { name: "search", args: { q: "b" } } },
            ],
            role: "model",
          },
        }],
      }),
      "data: [DONE]",
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "search" }] }),
    );

    const starts = chunks.filter((c) => c.type === "tool_call_start");
    expect(starts.length).toBe(2);
    expect(starts[0]!.toolCall!.id).not.toBe(starts[1]!.toolCall!.id);
  });

  // ── Usage metadata ────────────────────────────────────────────

  it("yields usage chunk when usageMetadata is present", async () => {
    mockStreamResponse([
      sseData(textChunk("Hi", { prompt: 10, candidates: 3 })),
      "data: [DONE]",
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "Hi" }] }),
    );

    const usageChunks = chunks.filter((c) => c.type === "usage");
    expect(usageChunks.length).toBe(1);
    expect(usageChunks[0]!.usage).toEqual({
      inputTokens: 10,
      outputTokens: 3,
    });
  });

  // ── Mixed: text + tool + usage in sequence ────────────────────

  it("handles text followed by tool call with usage", async () => {
    mockStreamResponse([
      sseData(textChunk("Let me check.")),
      sseData(toolCallChunk("get_weather", { city: "NYC" }, { prompt: 20, candidates: 15 })),
      "data: [DONE]",
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "Weather?" }] }),
    );

    const types = chunks.map((c) => c.type);
    expect(types).toEqual(["text", "tool_call_start", "tool_call_end", "usage"]);
  });

  // ── SSE edge cases ────────────────────────────────────────────

  it("skips unparseable JSON in SSE data", async () => {
    mockStreamResponse([
      "data: {not valid json",
      sseData(textChunk("OK")),
      "data: [DONE]",
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "Hi" }] }),
    );

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.length).toBe(1);
    expect(textChunks[0]!.text).toBe("OK");
  });

  it("skips SSE events with no candidates", async () => {
    mockStreamResponse([
      sseData({ candidates: [] }),
      sseData(textChunk("Got it")),
      "data: [DONE]",
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "Hi" }] }),
    );

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.length).toBe(1);
  });

  it("stops at [DONE] marker and ignores data after it", async () => {
    mockStreamResponse([
      sseData(textChunk("First")),
      "data: [DONE]",
      sseData(textChunk("Should not appear")),
    ]);

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const chunks = await collectChunks(
      model.stream({ messages: [{ role: "user", content: "Hi" }] }),
    );

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.length).toBe(1);
    expect(textChunks[0]!.text).toBe("First");
  });

  // ── Error handling ────────────────────────────────────────────

  it("throws ModelRateLimitError on 429", async () => {
    mockErrorResponse(429, "rate limited");

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    await expect(
      collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toThrow(ModelRateLimitError);
  });

  it("throws ModelAPIError on 500", async () => {
    mockErrorResponse(500, "internal error");

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    await expect(
      collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toThrow(ModelAPIError);
  });

  it("throws ModelAPIError when response has no body", async () => {
    mockNoBodyResponse();

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    await expect(
      collectChunks(model.stream({ messages: [{ role: "user", content: "Hi" }] })),
    ).rejects.toThrow(ModelAPIError);
  });
});
