import { describe, it, expect, vi, beforeEach } from "vitest";
import { anthropic } from "../models/anthropic.js";

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

describe("anthropic adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("chat() sends correct request and parses response", async () => {
    mockFetchResponse({
      id: "msg_01",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello there!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 5 },
    });

    const model = anthropic("claude-sonnet-4-20250514", {
      apiKey: "sk-test-key",
      baseUrl: "https://test.api.anthropic.com",
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
    expect(url).toBe("https://test.api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");

    const h = init.headers as Record<string, string>;
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["x-api-key"]).toBe("sk-test-key");
    expect(h["anthropic-version"]).toBe("2023-06-01");

    expect(body["model"]).toBe("claude-sonnet-4-20250514");
    expect(body["max_tokens"]).toBe(1024);
    expect((body["messages"] as unknown[]).length).toBe(1);
  });

  it("chat() parses tool_use response", async () => {
    mockFetchResponse({
      id: "msg_02",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "I'll check the weather." },
        {
          type: "tool_use",
          id: "toolu_01",
          name: "get_weather",
          input: { location: "London" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 30 },
    });

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-test" });
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
      id: "toolu_01",
      name: "get_weather",
      args: { location: "London" },
    });
  });

  it("chat() converts system messages to system param", async () => {
    mockFetchResponse({
      id: "msg_03",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Ahoy!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 15, output_tokens: 3 },
    });

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-test" });
    await model.chat({
      messages: [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "Hello" },
      ],
    });

    const { body } = lastFetchCall();

    // System message should be the system param, not in messages array
    expect(body["system"]).toBe("You are a pirate.");

    const msgs = body["messages"] as Array<{ role: string; content: string }>;
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.content).toBe("Hello");

    // No system role should appear in messages
    const hasSystem = msgs.some((m) => m.role === "system");
    expect(hasSystem).toBe(false);
  });

  it("chat() throws on API error", async () => {
    mockFetchResponse(
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      401,
    );

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "bad-key" });

    await expect(
      model.chat({ messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow(/Anthropic API error 401/);
  });

  it("has correct metadata", () => {
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-test" });

    expect(model.provider).toBe("anthropic");
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
    expect(model.capabilities).toEqual({
      tools: true,
      vision: true,
      streaming: true,
      embeddings: false,
    });
  });
});
