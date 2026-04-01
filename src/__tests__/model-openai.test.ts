import { describe, it, expect, vi, beforeEach } from "vitest";
import { openai } from "../models/openai.js";

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

describe("openai adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("chat() sends correct request and parses response", async () => {
    mockFetchResponse({
      id: "chatcmpl-abc123",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello there!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    });

    const model = openai("gpt-4o", {
      apiKey: "sk-test-key",
      baseUrl: "https://test.api.openai.com",
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
    expect(url).toBe("https://test.api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");

    const h = init.headers as Record<string, string>;
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["Authorization"]).toBe("Bearer sk-test-key");

    expect(body["model"]).toBe("gpt-4o");
    expect(body["max_tokens"]).toBe(1024);
    expect((body["messages"] as unknown[]).length).toBe(1);
  });

  it("chat() parses tool_calls response", async () => {
    mockFetchResponse({
      id: "chatcmpl-def456",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "I'll check the weather.",
            tool_calls: [
              {
                id: "call_01",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: JSON.stringify({ location: "London" }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
    });

    const model = openai("gpt-4o", { apiKey: "sk-test" });
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
    expect(result.toolCalls![0]).toEqual({
      id: "call_01",
      name: "get_weather",
      args: { location: "London" },
    });
  });

  it("embed() returns embeddings", async () => {
    mockFetchResponse({
      object: "list",
      data: [
        { object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
        { object: "embedding", index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });

    const model = openai("text-embedding-3-small", {
      apiKey: "sk-test-key",
      baseUrl: "https://test.api.openai.com",
    });

    const result = await model.embed!(["hello", "world"]);

    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);

    // Verify request
    const { url, init, body } = lastFetchCall();
    expect(url).toBe("https://test.api.openai.com/v1/embeddings");
    expect(init.method).toBe("POST");

    const h = init.headers as Record<string, string>;
    expect(h["Authorization"]).toBe("Bearer sk-test-key");

    expect(body["model"]).toBe("text-embedding-3-small");
    expect(body["input"]).toEqual(["hello", "world"]);
  });

  it("chat() passes image content parts through to the API", async () => {
    mockFetchResponse({
      id: "chatcmpl-vision",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "I see a cat." },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    });

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    await model.chat({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this image?" },
            { type: "image", imageUrl: "data:image/png;base64,iVBOR..." },
          ],
        },
      ],
    });

    const { body } = lastFetchCall();
    const messages = body["messages"] as Array<Record<string, unknown>>;
    const content = messages[0]!["content"] as Array<Record<string, unknown>>;

    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(2);
    expect(content[0]).toEqual({ type: "text", text: "What's in this image?" });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBOR..." },
    });
  });

  it("has correct metadata", () => {
    const model = openai("gpt-4o", { apiKey: "sk-test" });

    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-4o");
    expect(model.capabilities).toEqual({
      tools: true,
      vision: true,
      streaming: true,
      embeddings: true,
    });
  });
});
