import { describe, it, expect, vi, beforeEach } from "vitest";
import { openai } from "../models/openai.js";
import { anthropic } from "../models/anthropic.js";
import { openrouter } from "../models/openrouter.js";
import { google } from "../models/google.js";
import { ModelAPIError, ModelRateLimitError, ONIError } from "../errors.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function mockFetchError(status: number, body: string, headers?: Record<string, string>): void {
  const response = {
    ok: false,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
    body: null,
    headers: new Map(Object.entries(headers ?? {})),
  } as unknown as Response;

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

const chatParams = { messages: [{ role: "user" as const, content: "Hi" }] };

/* ------------------------------------------------------------------ */
/*  ModelAPIError structure                                            */
/* ------------------------------------------------------------------ */

describe("ModelAPIError", () => {
  it("has correct ONI error properties", () => {
    const err = new ModelAPIError("openai", 400, "bad request");
    expect(err).toBeInstanceOf(ONIError);
    expect(err.code).toBe("ONI_MODEL_API");
    expect(err.category).toBe("MODEL");
    expect(err.name).toBe("ModelAPIError");
    expect(err.context["provider"]).toBe("openai");
    expect(err.context["status"]).toBe(400);
    expect(err.context["body"]).toBe("bad request");
  });

  it("4xx errors are not recoverable", () => {
    const err = new ModelAPIError("openai", 400, "bad");
    expect(err.recoverable).toBe(false);
  });

  it("5xx errors are recoverable", () => {
    const err = new ModelAPIError("openai", 500, "internal");
    expect(err.recoverable).toBe(true);
  });

  it("supports provider-specific suggestion overrides", () => {
    const err = new ModelAPIError("openrouter", 401, "unauthorized", {
      suggestion: "Rotate the OpenRouter key.",
      messageBody: "unauthorized Hint: Rotate the OpenRouter key.",
    });
    expect(err.message).toContain("Rotate the OpenRouter key.");
    expect(err.suggestion).toContain("Rotate the OpenRouter key.");
  });
});

/* ------------------------------------------------------------------ */
/*  OpenAI                                                            */
/* ------------------------------------------------------------------ */

describe("openai error handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws ModelAPIError on 400", async () => {
    mockFetchError(400, "invalid request body");
    const model = openai("gpt-4o", { apiKey: "sk-test" });
    await expect(model.chat(chatParams)).rejects.toThrow(ModelAPIError);
  });

  it("throws ModelAPIError on 500 (recoverable)", async () => {
    mockFetchError(500, "internal server error");
    const model = openai("gpt-4o", { apiKey: "sk-test" });
    try {
      await model.chat(chatParams);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ModelAPIError);
      expect((err as ModelAPIError).recoverable).toBe(true);
      expect((err as ModelAPIError).context["status"]).toBe(500);
    }
  });

  it("throws ModelRateLimitError on 429", async () => {
    mockFetchError(429, "rate limit exceeded", { "retry-after": "30" });
    const model = openai("gpt-4o", { apiKey: "sk-test" });
    await expect(model.chat(chatParams)).rejects.toThrow(ModelRateLimitError);
  });

  it("stream throws ModelAPIError on error", async () => {
    mockFetchError(401, "unauthorized");
    const model = openai("gpt-4o", { apiKey: "sk-test" });
    const gen = model.stream(chatParams);
    await expect(gen.next()).rejects.toThrow(ModelAPIError);
  });
});

/* ------------------------------------------------------------------ */
/*  Anthropic                                                         */
/* ------------------------------------------------------------------ */

describe("anthropic error handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws ModelAPIError on 400", async () => {
    mockFetchError(400, "invalid request");
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    await expect(model.chat(chatParams)).rejects.toThrow(ModelAPIError);
  });

  it("throws ModelRateLimitError on 429", async () => {
    mockFetchError(429, "rate limited");
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-ant-test" });
    await expect(model.chat(chatParams)).rejects.toThrow(ModelRateLimitError);
  });
});

/* ------------------------------------------------------------------ */
/*  OpenRouter                                                        */
/* ------------------------------------------------------------------ */

describe("openrouter error handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws ModelAPIError on 400", async () => {
    mockFetchError(400, "bad request");
    const model = openrouter("openai/gpt-4o", { apiKey: "or-test" });
    await expect(model.chat(chatParams)).rejects.toThrow(ModelAPIError);
  });

  it("throws ModelRateLimitError on 429", async () => {
    mockFetchError(429, "too many requests");
    const model = openrouter("openai/gpt-4o", { apiKey: "or-test" });
    await expect(model.chat(chatParams)).rejects.toThrow(ModelRateLimitError);
  });

  it("adds auth guidance for OpenRouter 401 responses", async () => {
    mockFetchError(401, "{\"error\":{\"message\":\"Missing Authentication header\",\"code\":401}}");
    const model = openrouter("openai/gpt-4o", { apiKey: "or-test" });

    try {
      await model.chat(chatParams);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ModelAPIError);
      expect((err as ModelAPIError).message).toContain("OPENROUTER_API_KEY");
      expect((err as ModelAPIError).suggestion).toContain("Authorization headers");
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Google                                                            */
/* ------------------------------------------------------------------ */

describe("google error handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws ModelAPIError on 400", async () => {
    mockFetchError(400, "invalid");
    const model = google("gemini-2.0-flash", { apiKey: "goog-test" });
    await expect(model.chat(chatParams)).rejects.toThrow(ModelAPIError);
  });

  it("throws ModelRateLimitError on 429", async () => {
    mockFetchError(429, "quota exceeded");
    const model = google("gemini-2.0-flash", { apiKey: "goog-test" });
    await expect(model.chat(chatParams)).rejects.toThrow(ModelRateLimitError);
  });
});
