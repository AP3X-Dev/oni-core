/**
 * Regression test for BUG-0261
 *
 * `fallbackTruncation` used to silently return only the two-message header
 * (truncation notice + "Context loaded.") with no actual conversation history
 * when the most recent message alone exceeded the character budget.
 *
 * Fix: when the most recent message (first examined in the backward walk)
 * exceeds the budget and nothing has been kept yet, the message is truncated
 * to fit rather than being dropped entirely.
 */

import { describe, it, expect, vi } from "vitest";
import { ContextCompactor } from "../harness/context-compactor.js";
import type { ONIModel, ONIModelMessage, ChatResponse, ChatChunk } from "../models/types.js";

function createFailingModel(): ONIModel {
  return {
    chat: vi.fn().mockRejectedValue(new Error("model unavailable")),
    stream: vi.fn() as unknown as (params: unknown) => AsyncGenerator<ChatChunk>,
    provider: "mock",
    modelId: "mock-fail",
    capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
  };
}

describe("BUG-0261: fallbackTruncation preserves oversized most-recent message", () => {
  it("truncates the most recent message to fit the budget instead of dropping it", async () => {
    // maxTokens=50, threshold=1.0, charsPerToken=1 → budget = 50 * 1.0 * 1 = 50 chars
    // Single message with 200 chars exceeds budget; old bug returned only the header.
    const model = createFailingModel();
    const compactor = new ContextCompactor({
      summaryModel: model,
      maxTokens: 50,
      charsPerToken: 1,
      threshold: 1.0,
    });

    const bigMessage: ONIModelMessage = {
      role: "user",
      content: "A".repeat(200),
    };

    const result = await compactor.compact([bigMessage]);

    // Must include the truncation header (user + assistant)
    expect(result.length).toBeGreaterThanOrEqual(3);

    const header = result[0];
    expect(header.role).toBe("user");
    expect(typeof header.content).toBe("string");
    expect((header.content as string)).toContain("conversation was truncated");

    // The truncated message must be present (3rd element)
    const truncated = result[2];
    expect(truncated).toBeDefined();
    expect(truncated.role).toBe("user");
    expect(typeof truncated.content).toBe("string");
    // Must end with the truncation suffix injected by the fix
    expect((truncated.content as string)).toContain("[truncated]");
    // Must not be empty content (just the suffix)
    const content = truncated.content as string;
    expect(content.length).toBeGreaterThan("[truncated]".length);
  });

  it("does not exceed budget in the truncated result", async () => {
    // budget = 60 chars (maxTokens=60, threshold=1.0, charsPerToken=1)
    const model = createFailingModel();
    const compactor = new ContextCompactor({
      summaryModel: model,
      maxTokens: 60,
      charsPerToken: 1,
      threshold: 1.0,
    });

    const bigMessage: ONIModelMessage = {
      role: "user",
      content: "B".repeat(300),
    };

    const result = await compactor.compact([bigMessage]);

    // The retained message content should fit within the 60-char budget
    const retained = result.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        (m.content as string).includes("[truncated]"),
    );
    expect(retained).toBeDefined();
    const retainedLen = (retained!.content as string).length;
    expect(retainedLen).toBeLessThanOrEqual(60);
  });

  it("works with array-content (ContentPart[]) messages", async () => {
    const model = createFailingModel();
    const compactor = new ContextCompactor({
      summaryModel: model,
      maxTokens: 50,
      charsPerToken: 1,
      threshold: 1.0,
    });

    const bigMessage: ONIModelMessage = {
      role: "user",
      content: [
        { type: "text", text: "C".repeat(100) },
        { type: "text", text: "D".repeat(100) },
      ],
    };

    const result = await compactor.compact([bigMessage]);

    // The truncated message should be present and use array content
    const retained = result.find(
      (m) => m.role === "user" && Array.isArray(m.content),
    );
    expect(retained).toBeDefined();
    const parts = retained!.content as Array<{ type: string; text?: string }>;
    const lastPart = parts[parts.length - 1];
    expect(lastPart.text).toContain("[truncated]");
  });
});
