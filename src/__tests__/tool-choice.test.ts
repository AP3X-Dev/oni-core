import { describe, it, expect, vi, beforeEach } from "vitest";
import { openai } from "../models/openai.js";
import { openrouter } from "../models/openrouter.js";
import { anthropic } from "../models/anthropic.js";
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

function lastFetchCall(): { body: Record<string, unknown> } {
  const mock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [, init] = mock.mock.calls[0] as [string, RequestInit];
  return { body: JSON.parse(init.body as string) as Record<string, unknown> };
}

const tools = [{
  name: "search",
  description: "Search the web",
  parameters: { type: "object", properties: { query: { type: "string" } } },
}];

const openaiResponse = {
  id: "chatcmpl-tc",
  object: "chat.completion",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

const anthropicResponse = {
  id: "msg_tc",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5 },
};

const geminiResponse = {
  candidates: [{
    content: { parts: [{ text: "ok" }], role: "model" },
    finishReason: "STOP",
  }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
};

/* ------------------------------------------------------------------ */
/*  OpenAI                                                            */
/* ------------------------------------------------------------------ */

describe("openai toolChoice", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends tool_choice: 'none' to suppress tool use", async () => {
    mockFetchResponse(openaiResponse);
    const model = openai("gpt-4o", { apiKey: "sk-test" });
    await model.chat({ messages: [{ role: "user", content: "Hi" }], tools, toolChoice: "none" });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toBe("none");
  });

  it("sends tool_choice: 'required' to force tool use", async () => {
    mockFetchResponse(openaiResponse);
    const model = openai("gpt-4o", { apiKey: "sk-test" });
    await model.chat({ messages: [{ role: "user", content: "Search" }], tools, toolChoice: "required" });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toBe("required");
  });

  it("sends tool_choice with specific function name", async () => {
    mockFetchResponse(openaiResponse);
    const model = openai("gpt-4o", { apiKey: "sk-test" });
    await model.chat({ messages: [{ role: "user", content: "Search" }], tools, toolChoice: { name: "search" } });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toEqual({ type: "function", function: { name: "search" } });
  });

  it("defaults to no tool_choice when not specified", async () => {
    mockFetchResponse(openaiResponse);
    const model = openai("gpt-4o", { apiKey: "sk-test" });
    await model.chat({ messages: [{ role: "user", content: "Hi" }], tools });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  OpenRouter                                                        */
/* ------------------------------------------------------------------ */

describe("openrouter toolChoice", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends tool_choice: 'required' via ChatParams", async () => {
    mockFetchResponse(openaiResponse);
    const model = openrouter("openai/gpt-4o", { apiKey: "or-test" });
    await model.chat({ messages: [{ role: "user", content: "Search" }], tools, toolChoice: "required" });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toBe("required");
  });

  it("sends named tool_choice via ChatParams", async () => {
    mockFetchResponse(openaiResponse);
    const model = openrouter("openai/gpt-4o", { apiKey: "or-test" });
    await model.chat({ messages: [{ role: "user", content: "Search" }], tools, toolChoice: { name: "search" } });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toEqual({ type: "function", function: { name: "search" } });
  });
});

/* ------------------------------------------------------------------ */
/*  Anthropic                                                         */
/* ------------------------------------------------------------------ */

describe("anthropic toolChoice", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends tool_choice type 'any' for 'required'", async () => {
    mockFetchResponse(anthropicResponse);
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    await model.chat({ messages: [{ role: "user", content: "Search" }], tools, toolChoice: "required" });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toEqual({ type: "any" });
  });

  it("sends tool_choice type 'auto' for 'auto'", async () => {
    mockFetchResponse(anthropicResponse);
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    await model.chat({ messages: [{ role: "user", content: "Hi" }], tools, toolChoice: "auto" });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toEqual({ type: "auto" });
  });

  it("sends tool_choice with specific tool name", async () => {
    mockFetchResponse(anthropicResponse);
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    await model.chat({ messages: [{ role: "user", content: "Search" }], tools, toolChoice: { name: "search" } });

    const { body } = lastFetchCall();
    expect(body["tool_choice"]).toEqual({ type: "tool", name: "search" });
  });

  it("omits tools entirely for 'none'", async () => {
    mockFetchResponse(anthropicResponse);
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    await model.chat({ messages: [{ role: "user", content: "Hi" }], tools, toolChoice: "none" });

    const { body } = lastFetchCall();
    // Anthropic has no "none" tool_choice — just omit tools
    expect(body["tools"]).toBeUndefined();
    expect(body["tool_choice"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Google                                                            */
/* ------------------------------------------------------------------ */

describe("google toolChoice", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends functionCallingConfig mode AUTO", async () => {
    mockFetchResponse(geminiResponse);
    const model = google("gemini-2.0-flash", { apiKey: "goog-test" });
    await model.chat({ messages: [{ role: "user", content: "Hi" }], tools, toolChoice: "auto" });

    const { body } = lastFetchCall();
    const toolConfig = body["toolConfig"] as Record<string, unknown>;
    const fcConfig = toolConfig["functionCallingConfig"] as Record<string, unknown>;
    expect(fcConfig["mode"]).toBe("AUTO");
  });

  it("sends functionCallingConfig mode NONE", async () => {
    mockFetchResponse(geminiResponse);
    const model = google("gemini-2.0-flash", { apiKey: "goog-test" });
    await model.chat({ messages: [{ role: "user", content: "Hi" }], tools, toolChoice: "none" });

    const { body } = lastFetchCall();
    const toolConfig = body["toolConfig"] as Record<string, unknown>;
    const fcConfig = toolConfig["functionCallingConfig"] as Record<string, unknown>;
    expect(fcConfig["mode"]).toBe("NONE");
  });

  it("sends functionCallingConfig mode ANY for 'required'", async () => {
    mockFetchResponse(geminiResponse);
    const model = google("gemini-2.0-flash", { apiKey: "goog-test" });
    await model.chat({ messages: [{ role: "user", content: "Search" }], tools, toolChoice: "required" });

    const { body } = lastFetchCall();
    const toolConfig = body["toolConfig"] as Record<string, unknown>;
    const fcConfig = toolConfig["functionCallingConfig"] as Record<string, unknown>;
    expect(fcConfig["mode"]).toBe("ANY");
  });

  it("sends allowedFunctionNames for named tool choice", async () => {
    mockFetchResponse(geminiResponse);
    const model = google("gemini-2.0-flash", { apiKey: "goog-test" });
    await model.chat({ messages: [{ role: "user", content: "Search" }], tools, toolChoice: { name: "search" } });

    const { body } = lastFetchCall();
    const toolConfig = body["toolConfig"] as Record<string, unknown>;
    const fcConfig = toolConfig["functionCallingConfig"] as Record<string, unknown>;
    expect(fcConfig["mode"]).toBe("ANY");
    expect(fcConfig["allowedFunctionNames"]).toEqual(["search"]);
  });
});
