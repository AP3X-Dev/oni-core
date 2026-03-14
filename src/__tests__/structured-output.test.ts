import { describe, it, expect, vi, beforeEach } from "vitest";
import { openai } from "../models/openai.js";
import { openrouter } from "../models/openrouter.js";
import { google } from "../models/google.js";
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

const personSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "integer" },
  },
  required: ["name", "age"],
  additionalProperties: false,
};

/* ------------------------------------------------------------------ */
/*  OpenAI structured output                                          */
/* ------------------------------------------------------------------ */

describe("openai structured output", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends response_format with json_schema to the API", async () => {
    mockFetchResponse({
      id: "chatcmpl-structured",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: '{"name":"Alice","age":30}' },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const _result = await model.chat({
      messages: [{ role: "user", content: "Extract: Alice is 30" }],
      responseFormat: {
        type: "json_schema",
        name: "person",
        schema: personSchema,
      },
    });

    // Verify request body has response_format
    const { body } = lastFetchCall();
    const rf = body["response_format"] as Record<string, unknown>;
    expect(rf).toBeDefined();
    expect(rf["type"]).toBe("json_schema");
    const jsonSchema = rf["json_schema"] as Record<string, unknown>;
    expect(jsonSchema["name"]).toBe("person");
    expect(jsonSchema["schema"]).toEqual(personSchema);
    expect(jsonSchema["strict"]).toBe(true);
  });

  it("auto-parses JSON content into parsed field", async () => {
    mockFetchResponse({
      id: "chatcmpl-structured2",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: '{"name":"Bob","age":25}' },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "Extract: Bob is 25" }],
      responseFormat: {
        type: "json_schema",
        name: "person",
        schema: personSchema,
      },
    });

    expect(result.parsed).toEqual({ name: "Bob", age: 25 });
    expect(result.content).toBe('{"name":"Bob","age":25}');
  });

  it("parsed is undefined when responseFormat is not set", async () => {
    mockFetchResponse({
      id: "chatcmpl-normal",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Just text" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.parsed).toBeUndefined();
  });

  it("strict defaults to true but can be set to false", async () => {
    mockFetchResponse({
      id: "chatcmpl-nostrict",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: '{}' },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    await model.chat({
      messages: [{ role: "user", content: "Extract" }],
      responseFormat: {
        type: "json_schema",
        name: "loose",
        schema: personSchema,
        strict: false,
      },
    });

    const { body } = lastFetchCall();
    const rf = body["response_format"] as Record<string, unknown>;
    const jsonSchema = rf["json_schema"] as Record<string, unknown>;
    expect(jsonSchema["strict"]).toBe(false);
  });

  it("handles malformed JSON in structured output gracefully", async () => {
    mockFetchResponse({
      id: "chatcmpl-bad",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "{broken json" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "Extract" }],
      responseFormat: {
        type: "json_schema",
        name: "person",
        schema: personSchema,
      },
    });

    // Should not throw, just leave parsed undefined
    expect(result.parsed).toBeUndefined();
    expect(result.content).toBe("{broken json");
  });
});

/* ------------------------------------------------------------------ */
/*  OpenRouter structured output (same wire format as OpenAI)         */
/* ------------------------------------------------------------------ */

describe("openrouter structured output", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends response_format with json_schema to the API", async () => {
    mockFetchResponse({
      id: "gen-structured",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: '{"name":"Carol","age":40}' },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });

    const model = openrouter("openai/gpt-4o", { apiKey: "or-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "Extract: Carol is 40" }],
      responseFormat: {
        type: "json_schema",
        name: "person",
        schema: personSchema,
      },
    });

    const { body } = lastFetchCall();
    const rf = body["response_format"] as Record<string, unknown>;
    expect(rf).toBeDefined();
    expect(rf["type"]).toBe("json_schema");

    expect(result.parsed).toEqual({ name: "Carol", age: 40 });
  });
});

/* ------------------------------------------------------------------ */
/*  Google structured output                                          */
/* ------------------------------------------------------------------ */

describe("google structured output", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends responseMimeType and responseSchema in generationConfig", async () => {
    mockFetchResponse({
      candidates: [{
        content: { parts: [{ text: '{"name":"Dave","age":50}' }], role: "model" },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
    });

    const model = google("gemini-2.0-flash", { apiKey: "goog-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "Extract: Dave is 50" }],
      responseFormat: {
        type: "json_schema",
        name: "person",
        schema: personSchema,
      },
    });

    const { body } = lastFetchCall();
    const genConfig = body["generationConfig"] as Record<string, unknown>;
    expect(genConfig["responseMimeType"]).toBe("application/json");
    expect(genConfig["responseSchema"]).toEqual(personSchema);

    expect(result.parsed).toEqual({ name: "Dave", age: 50 });
  });
});

/* ------------------------------------------------------------------ */
/*  Anthropic structured output (tool-use pattern)                    */
/* ------------------------------------------------------------------ */

describe("anthropic structured output", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends a synthetic tool with forced tool_choice", async () => {
    mockFetchResponse({
      id: "msg_structured",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "person",
          input: { name: "Eve", age: 28 },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 30, output_tokens: 15 },
    });

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    await model.chat({
      messages: [{ role: "user", content: "Extract: Eve is 28" }],
      responseFormat: {
        type: "json_schema",
        name: "person",
        schema: personSchema,
      },
    });

    const { body } = lastFetchCall();
    // Should have a tool matching the schema
    const tools = body["tools"] as Array<Record<string, unknown>>;
    expect(tools).toBeDefined();
    expect(tools.length).toBe(1);
    expect(tools[0]!["name"]).toBe("person");
    expect(tools[0]!["input_schema"]).toEqual(personSchema);

    // Should force that specific tool
    const toolChoice = body["tool_choice"] as Record<string, unknown>;
    expect(toolChoice).toEqual({ type: "tool", name: "person" });
  });

  it("extracts parsed from tool_use input, not text content", async () => {
    mockFetchResponse({
      id: "msg_structured2",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Here is the extracted data:" },
        {
          type: "tool_use",
          id: "toolu_02",
          name: "person",
          input: { name: "Frank", age: 45 },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 30, output_tokens: 20 },
    });

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "Extract: Frank is 45" }],
      responseFormat: {
        type: "json_schema",
        name: "person",
        schema: personSchema,
      },
    });

    // parsed comes from the tool input, not from text
    expect(result.parsed).toEqual({ name: "Frank", age: 45 });
    // content should still have the text part
    expect(result.content).toBe("Here is the extracted data:");
    // toolCalls should be suppressed since this is structured output, not a real tool call
    expect(result.toolCalls).toBeUndefined();
    // stopReason should be "end" since the tool_use was for structured output
    expect(result.stopReason).toBe("end");
  });

  it("parsed is undefined when responseFormat is not set", async () => {
    mockFetchResponse({
      id: "msg_normal",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Just text" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    const result = await model.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.parsed).toBeUndefined();
  });
});
