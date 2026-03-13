import { describe, it, expect, vi, beforeEach } from "vitest";
import { ollama } from "../models/ollama.js";

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

describe("ollama adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("chat() sends to localhost:11434 by default", async () => {
    mockFetchResponse({
      model: "llama3",
      message: { role: "assistant", content: "Hello there!" },
      done: true,
      prompt_eval_count: 12,
      eval_count: 5,
    });

    const model = ollama("llama3");

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
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(init.method).toBe("POST");

    const h = init.headers as Record<string, string>;
    expect(h["Content-Type"]).toBe("application/json");

    expect(body["model"]).toBe("llama3");
    expect(body["stream"]).toBe(false);

    const options = body["options"] as Record<string, unknown>;
    expect(options["num_predict"]).toBe(1024);
  });

  it("supports custom baseUrl", async () => {
    mockFetchResponse({
      model: "llama3",
      message: { role: "assistant", content: "Hi from remote!" },
      done: true,
      prompt_eval_count: 8,
      eval_count: 4,
    });

    const model = ollama("llama3", {
      baseUrl: "http://my-server:11434",
    });

    await model.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    const { url } = lastFetchCall();
    expect(url).toBe("http://my-server:11434/api/chat");
  });

  it("has correct metadata", () => {
    const model = ollama("llama3");

    expect(model.provider).toBe("ollama");
    expect(model.modelId).toBe("llama3");
    expect(model.capabilities).toEqual({
      tools: false,
      vision: false,
      streaming: true,
      embeddings: true,
    });
  });
});
