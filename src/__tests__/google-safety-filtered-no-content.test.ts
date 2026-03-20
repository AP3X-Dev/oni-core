import { describe, it, expect, vi, beforeEach } from "vitest";
import { google } from "../models/google.js";

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

describe("google gemini adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0274: chat() handles safety-filtered response with missing candidate.content", async () => {
    // Before the fix, accessing candidate.content.parts threw TypeError
    // when Gemini returns a candidate with finishReason SAFETY but no content field.
    mockFetchResponse({
      candidates: [
        {
          finishReason: "SAFETY",
          // content is intentionally omitted — this is what Gemini returns for filtered responses
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 0,
      },
    });

    const model = google("gemini-2.0-flash", { apiKey: "test-key" });
    const result = await model.chat({
      messages: [{ role: "user", content: "test" }],
      maxTokens: 100,
    });

    expect(result.content).toBe("");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(0);
  });
});
