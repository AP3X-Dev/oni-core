import { describe, it, expect, vi, beforeEach } from "vitest";
import { anthropic } from "../models/anthropic.js";

/**
 * Regression test for BUG-0029: Anthropic adapter must throw a descriptive error
 * when a tool result message is missing its toolCallId, rather than silently
 * sending `tool_use_id: undefined` to the API causing an opaque 400/422 error.
 */

describe("BUG-0029: anthropic adapter throws on missing toolCallId in tool result", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Stub fetch so we don't make real HTTP calls; if the guard doesn't fire
    // first this stub would return a malformed response and the test would fail
    // for the wrong reason.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad request" } }),
        text: async () => '{"error":{"message":"bad request"}}',
        body: null,
      } as unknown as Response),
    );
  });

  it("BUG-0029: throws descriptive error when tool message has no toolCallId", async () => {
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-test" });

    await expect(
      model.chat({
        messages: [
          { role: "user", content: "Call a tool" },
          {
            role: "tool",
            content: "tool output",
            // toolCallId intentionally omitted — simulates caller bug
          } as never,
        ],
        maxTokens: 256,
      }),
    ).rejects.toThrow(/toolCallId/);
  });

  it("BUG-0029: error message mentions tool_use_id requirement", async () => {
    const model = anthropic("claude-sonnet-4-20250514", { apiKey: "sk-test" });

    await expect(
      model.chat({
        messages: [
          { role: "user", content: "Call a tool" },
          { role: "tool", content: "result", toolCallId: undefined } as never,
        ],
        maxTokens: 256,
      }),
    ).rejects.toThrow(/tool_use_id/);
  });
});
