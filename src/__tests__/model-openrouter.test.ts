import { describe, it, expect, vi, beforeEach } from "vitest";
import { openrouter, inception } from "../models/openrouter.js";

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

const STANDARD_RESPONSE = {
  id: "gen-abc123",
  object: "chat.completion",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello from OpenRouter!" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("openrouter adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic chat ────────────────────────────────────────────────

  it("chat() sends correct request and parses response", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("anthropic/claude-sonnet-4-20250514", {
      apiKey: "sk-or-test",
      baseUrl: "https://test.openrouter.ai/api",
    });

    const result = await model.chat({
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 1024,
    });

    expect(result.content).toBe("Hello from OpenRouter!");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.stopReason).toBe("end");
    expect(result.toolCalls).toBeUndefined();
    expect(result.raw).toBeDefined();

    const { url, init, body } = lastFetchCall();
    expect(url).toBe("https://test.openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(body["model"]).toBe("anthropic/claude-sonnet-4-20250514");
    expect(body["max_tokens"]).toBe(1024);
  });

  // ── Tool calls ────────────────────────────────────────────────

  it("chat() parses tool_calls response", async () => {
    mockFetchResponse({
      id: "gen-def456",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Let me search for that.",
            tool_calls: [
              {
                id: "call_01",
                type: "function",
                function: {
                  name: "web_search",
                  arguments: JSON.stringify({ query: "typescript frameworks" }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
    });

    const model = openrouter("openai/gpt-4o", { apiKey: "sk-or-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "Search for typescript frameworks" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      ],
    });

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0]).toEqual({
      id: "call_01",
      name: "web_search",
      args: { query: "typescript frameworks" },
    });
  });

  it("chat() handles malformed tool call arguments gracefully", async () => {
    mockFetchResponse({
      id: "gen-bad",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_02",
                type: "function",
                function: {
                  name: "do_thing",
                  arguments: "not valid json{{{",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    });

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "do it" }],
    });

    expect(result.toolCalls![0].args).toEqual({});
    expect(result.content).toBe("");
  });

  // ── Message conversion ────────────────────────────────────────

  it("converts system prompt and all message types correctly", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    await model.chat({
      systemPrompt: "You are helpful.",
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: "I'll check.",
          toolCalls: [{ id: "tc1", name: "search", args: { q: "test" } }],
        },
        { role: "tool", content: "result data", toolCallId: "tc1" },
      ],
    });

    const { body } = lastFetchCall();
    const messages = body["messages"] as Array<Record<string, unknown>>;

    expect(messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });

    // Assistant with tool calls
    expect(messages[2]["role"]).toBe("assistant");
    expect(messages[2]["content"]).toBe("I'll check.");
    const tcs = messages[2]["tool_calls"] as Array<Record<string, unknown>>;
    expect(tcs[0]["id"]).toBe("tc1");
    expect((tcs[0]["function"] as Record<string, unknown>)["name"]).toBe("search");

    // Tool result
    expect(messages[3]["role"]).toBe("tool");
    expect(messages[3]["tool_call_id"]).toBe("tc1");
  });

  it("passes image content parts through to the API", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
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
    const content = messages[0]["content"] as Array<Record<string, unknown>>;

    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(2);
    expect(content[0]).toEqual({ type: "text", text: "What's in this image?" });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBOR..." },
    });
  });

  it("keeps text-only ContentPart[] as plain string", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    await model.chat({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      ],
    });

    const { body } = lastFetchCall();
    const messages = body["messages"] as Array<Record<string, unknown>>;
    expect(messages[0]["content"]).toBe("Hello world");
  });

  // ── OpenRouter-specific options ───────────────────────────────

  it("sends OpenRouter headers (HTTP-Referer, X-Title)", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", {
      apiKey: "sk-or-test",
      referer: "https://myapp.com",
      appTitle: "My App",
    });

    await model.chat({ messages: [{ role: "user", content: "test" }] });

    const { init } = lastFetchCall();
    const h = init.headers as Record<string, string>;
    expect(h["HTTP-Referer"]).toBe("https://myapp.com");
    expect(h["X-Title"]).toBe("My App");
    expect(h["Authorization"]).toBe("Bearer sk-or-test");
  });

  it("sends reasoning effort, provider prefs, and transforms", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", {
      apiKey: "sk-or-test",
      reasoningEffort: "high",
      provider: { order: ["Anthropic", "OpenAI"] },
      transforms: ["middle-out"],
    });

    await model.chat({ messages: [{ role: "user", content: "think hard" }] });

    const { body } = lastFetchCall();
    expect(body["reasoning"]).toEqual({ effort: "high" });
    expect(body["provider"]).toEqual({ order: ["Anthropic", "OpenAI"] });
    expect(body["transforms"]).toEqual(["middle-out"]);
  });

  it("sends tool_choice as string", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", {
      apiKey: "sk-or-test",
      toolChoice: "required",
    });

    await model.chat({
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "t", description: "d", parameters: {} }],
    });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toBe("required");
  });

  it("sends tool_choice as named function", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", {
      apiKey: "sk-or-test",
      toolChoice: { name: "specific_tool" },
    });

    await model.chat({
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "specific_tool", description: "d", parameters: {} }],
    });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toEqual({
      type: "function",
      function: { name: "specific_tool" },
    });
  });

  it("defaults tool_choice to 'auto' when tools present but no choice specified", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    await model.chat({
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "t", description: "d", parameters: {} }],
    });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toBe("auto");
  });

  it("sends parallel_tool_calls when configured", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", {
      apiKey: "sk-or-test",
      parallelToolCalls: false,
    });

    await model.chat({
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "t", description: "d", parameters: {} }],
    });

    const { body } = lastFetchCall();
    expect(body["parallel_tool_calls"]).toBe(false);
  });

  // ── Defaults ──────────────────────────────────────────────────

  it("applies defaultMaxTokens and defaultTemperature", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", {
      apiKey: "sk-or-test",
      defaultMaxTokens: 2048,
      defaultTemperature: 0.7,
    });

    await model.chat({ messages: [{ role: "user", content: "test" }] });

    const { body } = lastFetchCall();
    expect(body["max_tokens"]).toBe(2048);
    expect(body["temperature"]).toBe(0.7);
  });

  it("per-call params override defaults", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", {
      apiKey: "sk-or-test",
      defaultMaxTokens: 2048,
      defaultTemperature: 0.7,
    });

    await model.chat({
      messages: [{ role: "user", content: "test" }],
      maxTokens: 500,
      temperature: 0.1,
    });

    const { body } = lastFetchCall();
    expect(body["max_tokens"]).toBe(500);
    expect(body["temperature"]).toBe(0.1);
  });

  it("sends stop sequences when provided", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    await model.chat({
      messages: [{ role: "user", content: "test" }],
      stopSequences: ["STOP", "END"],
    });

    const { body } = lastFetchCall();
    expect(body["stop"]).toEqual(["STOP", "END"]);
  });

  // ── Error handling ────────────────────────────────────────────

  it("throws on non-200 response", async () => {
    mockFetchResponse({ error: { message: "Invalid API key" } }, 401);

    const model = openrouter("test/model", { apiKey: "bad-key" });

    await expect(
      model.chat({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow(/openrouter API error 401/);
  });

  // ── Finish reason mapping ────────────────────────────────────

  it("maps finish_reason 'length' to 'max_tokens'", async () => {
    mockFetchResponse({
      ...STANDARD_RESPONSE,
      choices: [{ ...STANDARD_RESPONSE.choices[0], finish_reason: "length" }],
    });

    const model = openrouter("test/model", { apiKey: "sk-or-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "test" }],
    });

    expect(result.stopReason).toBe("max_tokens");
  });

  // ── Metadata ──────────────────────────────────────────────────

  it("has correct metadata", () => {
    const model = openrouter("anthropic/claude-sonnet-4-20250514", { apiKey: "sk-or-test" });

    expect(model.provider).toBe("openrouter");
    expect(model.modelId).toBe("anthropic/claude-sonnet-4-20250514");
    expect(model.capabilities).toEqual({
      tools: true,
      vision: true,
      streaming: true,
      embeddings: false,
    });
  });

  // ── Base URL trailing slash ───────────────────────────────────

  it("strips trailing slash from baseUrl", async () => {
    mockFetchResponse(STANDARD_RESPONSE);

    const model = openrouter("test/model", {
      apiKey: "sk-or-test",
      baseUrl: "https://openrouter.ai/api/",
    });

    await model.chat({ messages: [{ role: "user", content: "test" }] });

    const { url } = lastFetchCall();
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });
});

/* ------------------------------------------------------------------ */
/*  inception() convenience factory                                    */
/* ------------------------------------------------------------------ */

describe("inception adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to inception/mercury-2 model", () => {
    const model = inception(undefined, { apiKey: "sk-or-test" });
    expect(model.modelId).toBe("inception/mercury-2");
    expect(model.provider).toBe("openrouter");
  });

  it("accepts custom model ID", () => {
    const model = inception("inception/mercury-coder", { apiKey: "sk-or-test" });
    expect(model.modelId).toBe("inception/mercury-coder");
  });

  it("passes through OpenRouter options", async () => {
    mockFetchResponse({
      id: "gen-inc",
      object: "chat.completion",
      choices: [
        { index: 0, message: { role: "assistant", content: "fast" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });

    const model = inception("inception/mercury-2", {
      apiKey: "sk-or-inc",
      appTitle: "Inception Test",
    });

    await model.chat({ messages: [{ role: "user", content: "hi" }] });

    const { init } = lastFetchCall();
    const h = init.headers as Record<string, string>;
    expect(h["X-Title"]).toBe("Inception Test");
    expect(h["Authorization"]).toBe("Bearer sk-or-inc");
  });
});
