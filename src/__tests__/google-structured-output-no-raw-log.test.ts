import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { google } from "../models/google.js";

/**
 * Regression test for BUG-0286.
 *
 * When responseFormat is set and the Gemini model returns non-JSON content,
 * the catch block in chat() must NOT log the raw model response text to
 * console.warn.  Logging raw content risks exposing PII, confidential data,
 * or secrets that appear in LLM output.
 *
 * The OpenAI adapter logs only content length (not content) — Google must
 * follow the same pattern.
 */
describe("google chat() structured-output parse failure does not log raw content (BUG-0286)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchWithTextContent(text: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text }], role: "model" },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 10,
            totalTokenCount: 15,
          },
        }),
        text: async () => "{}",
        body: null,
      } as unknown as Response),
    );
  }

  it("BUG-0286: does not include raw content text in console.warn on JSON parse failure", async () => {
    const sensitiveContent = "SECRET_API_KEY=abc123 and user SSN 123-45-6789";
    mockFetchWithTextContent(sensitiveContent);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const model = google("gemini-1.5-flash", { apiKey: "test-key" });
    await model.chat({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      responseFormat: {
        type: "json_schema",
        name: "test",
        schema: { type: "object", properties: { x: { type: "number" } } },
      },
    });

    // Must have warned (the warn itself is expected — we just check content safety)
    expect(warnSpy).toHaveBeenCalled();

    for (const [msg] of warnSpy.mock.calls) {
      if (typeof msg === "string") {
        expect(msg).not.toContain(sensitiveContent);
        expect(msg).not.toContain("SECRET_API_KEY");
        expect(msg).not.toContain("SSN");
      }
    }
  });

  it("BUG-0286: console.warn message mentions content length, not content", async () => {
    const longContent = "not-json ".repeat(50);
    mockFetchWithTextContent(longContent);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const model = google("gemini-1.5-flash", { apiKey: "test-key" });
    await model.chat({
      messages: [{ role: "user", content: [{ type: "text", text: "q" }] }],
      responseFormat: {
        type: "json_schema",
        name: "test",
        schema: { type: "object" },
      },
    });

    if (warnSpy.mock.calls.length > 0) {
      const [msg] = warnSpy.mock.calls[0]!;
      if (typeof msg === "string") {
        // Should NOT contain the actual non-JSON text
        expect(msg).not.toContain("not-json");
      }
    }
  });
});
