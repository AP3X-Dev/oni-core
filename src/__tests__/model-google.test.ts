import { describe, it, expect, vi, beforeEach } from "vitest";
import { google } from "../models/google.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function mockFetchResponse(body: unknown, status = 200): void {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response;

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

function lastFetchCall(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const mock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [url, init] = mock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("google gemini adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("chat() sends to Gemini API and parses response", async () => {
    mockFetchResponse({
      candidates: [
        {
          content: {
            parts: [{ text: "Hello there!" }],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 5,
        totalTokenCount: 17,
      },
    });

    const model = google("gemini-2.0-flash", {
      apiKey: "test-api-key",
    });

    const result = await model.chat({
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 1024,
    });

    // Verify response parsing
    expect(result.content).toBe("Hello there!");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(result.stopReason).toBe("end");
    expect(result.toolCalls).toBeUndefined();

    // Verify request
    const { url, init, body } = lastFetchCall();
    expect(url).toContain("gemini-2.0-flash:generateContent");
    expect(url).not.toContain("key=");
    expect(init.method).toBe("POST");

    const h = init.headers as Record<string, string>;
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["x-goog-api-key"]).toBe("test-api-key");

    const contents = body["contents"] as Array<Record<string, unknown>>;
    expect(contents.length).toBe(1);

    const generationConfig = body["generationConfig"] as Record<string, unknown>;
    expect(generationConfig["maxOutputTokens"]).toBe(1024);
  });

  it("chat() parses function call response", async () => {
    mockFetchResponse({
      candidates: [
        {
          content: {
            parts: [
              { text: "I'll check the weather." },
              {
                functionCall: {
                  name: "get_weather",
                  args: { location: "London" },
                },
              },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 30,
        totalTokenCount: 50,
      },
    });

    const model = google("gemini-2.0-flash", { apiKey: "test-api-key" });
    const result = await model.chat({
      messages: [{ role: "user", content: "What is the weather in London?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { location: { type: "string" } } },
        },
      ],
    });

    expect(result.content).toBe("I'll check the weather.");
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0]!.name).toBe("get_weather");
    expect(result.toolCalls![0]!.args).toEqual({ location: "London" });
  });

  it("has correct metadata", () => {
    const model = google("gemini-2.0-flash", { apiKey: "test-api-key" });

    expect(model.provider).toBe("google");
    expect(model.modelId).toBe("gemini-2.0-flash");
    expect(model.capabilities).toEqual({
      tools: true,
      vision: true,
      streaming: true,
      embeddings: true,
    });
  });
});
