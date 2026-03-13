import { describe, it, expect, vi } from "vitest";
import { ContextCompactor } from "../harness/context-compactor.js";
import type { ONIModel, ONIModelMessage, ChatResponse, ChatChunk } from "../models/types.js";

// ─── Mock Model Helper ──────────────────────────────────────────────────────

function createMockModel(overrides?: {
  content?: string;
  error?: boolean;
}): ONIModel {
  const chatFn = overrides?.error
    ? vi.fn().mockRejectedValue(new Error("model error"))
    : vi.fn().mockResolvedValue({
        content: overrides?.content ?? "<summary>Compacted summary</summary>",
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: "end" as const,
      } satisfies ChatResponse);

  return {
    chat: chatFn,
    stream: vi.fn() as unknown as (params: any) => AsyncGenerator<ChatChunk>,
    provider: "mock",
    modelId: "mock-summary-model",
    capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build an array of messages with approximately `totalChars` of content */
function buildMessages(count: number, charsPer: number): ONIModelMessage[] {
  const msgs: ONIModelMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(charsPer),
    });
  }
  return msgs;
}

function buildToolMessages(toolCount: number, userCount: number): ONIModelMessage[] {
  const msgs: ONIModelMessage[] = [];
  for (let i = 0; i < toolCount; i++) {
    msgs.push({
      role: "tool",
      content: "tool result " + "y".repeat(100),
      toolCallId: `tc_${i}`,
      name: `tool_${i}`,
    });
  }
  for (let i = 0; i < userCount; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "recent " + "z".repeat(50),
    });
  }
  return msgs;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ContextCompactor", () => {
  describe("estimateTokens()", () => {
    it("estimates based on char count with default charsPerToken", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({ summaryModel: model });

      // 400 chars total / 4 charsPerToken = 100 tokens
      const msgs: ONIModelMessage[] = [
        { role: "user", content: "a".repeat(200) },
        { role: "assistant", content: "b".repeat(200) },
      ];

      expect(compactor.estimateTokens(msgs)).toBe(100);
    });

    it("uses custom charsPerToken", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({
        summaryModel: model,
        charsPerToken: 2,
      });

      // 100 chars / 2 = 50 tokens
      const msgs: ONIModelMessage[] = [
        { role: "user", content: "a".repeat(100) },
      ];

      expect(compactor.estimateTokens(msgs)).toBe(50);
    });

    it("applies ceiling for fractional results", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({ summaryModel: model });

      // 5 chars / 4 = 1.25 → ceil → 2
      const msgs: ONIModelMessage[] = [
        { role: "user", content: "hello" },
      ];

      expect(compactor.estimateTokens(msgs)).toBe(2);
    });

    it("handles ContentPart[] content", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({ summaryModel: model });

      const msgs: ONIModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "a".repeat(100) },
            { type: "text", text: "b".repeat(100) },
          ],
        },
      ];

      // 200 chars / 4 = 50
      expect(compactor.estimateTokens(msgs)).toBe(50);
    });
  });

  describe("shouldCompact()", () => {
    it("returns false below threshold", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 1000,
        charsPerToken: 1,
      });

      // 500 chars / 1 charsPerToken = 500 tokens; 500/1000 = 0.5 < 0.68
      const msgs = buildMessages(5, 100);
      expect(compactor.shouldCompact(msgs)).toBe(false);
    });

    it("returns true above threshold", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 1000,
        charsPerToken: 1,
      });

      // 700 chars / 1 charsPerToken = 700 tokens; 700/1000 = 0.7 >= 0.68
      const msgs = buildMessages(7, 100);
      expect(compactor.shouldCompact(msgs)).toBe(true);
    });

    it("respects custom threshold", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 1000,
        charsPerToken: 1,
        threshold: 0.5,
      });

      // 500 chars / 1 charsPerToken = 500 tokens; 500/1000 = 0.5 >= 0.5
      const msgs = buildMessages(5, 100);
      expect(compactor.shouldCompact(msgs)).toBe(true);
    });
  });

  describe("usageFraction()", () => {
    it("returns current usage ratio", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 1000,
        charsPerToken: 1,
      });

      // 400 chars / 1 = 400 tokens; 400/1000 = 0.4
      const msgs = buildMessages(4, 100);
      expect(compactor.usageFraction(msgs)).toBeCloseTo(0.4, 5);
    });

    it("returns 0 for empty messages", () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 1000,
      });

      expect(compactor.usageFraction([])).toBe(0);
    });
  });

  describe("compact()", () => {
    it("first tries clearing old tool results", async () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 2000,
        charsPerToken: 1,
      });

      // 30 old tool messages (30 * 110 = 3300 chars) + 5 recent user/assistant (5 * 50 = 250)
      // Total = 3550 chars → 3550/2000 = 1.775 (over 0.68 threshold)
      // keepRecent=10 → last 10 msgs kept intact (5 tool + 5 user/assistant)
      // After clearing older 20 tool msgs: 5 tool (550) + 5 user/assistant (250) = 800
      // 800/2000 = 0.4 (under 0.68) → no summarization needed
      const msgs: ONIModelMessage[] = [];
      for (let i = 0; i < 30; i++) {
        msgs.push({
          role: "tool",
          content: "y".repeat(110),
          toolCallId: `tc_${i}`,
          name: `tool_${i}`,
        });
      }
      for (let i = 0; i < 5; i++) {
        msgs.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: "z".repeat(50),
        });
      }

      const result = await compactor.compact(msgs);

      // Model should NOT have been called (tool cleanup was enough)
      expect(model.chat).not.toHaveBeenCalled();
      // Result should have fewer messages than original
      expect(result.length).toBeLessThan(msgs.length);
      // Should still contain the recent messages
      expect(result.length).toBe(10); // 5 recent tool + 5 user/assistant
    });

    it("returns summary messages when tool cleanup is not enough", async () => {
      const model = createMockModel({
        content: "<summary>This is a compacted summary of the conversation.</summary>",
      });
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 100,
        charsPerToken: 1,
      });

      // 200 chars / 1 = 200 tokens; 200/100 = 2.0 (way over 0.68)
      // No tool messages to clear, so goes straight to summarization
      const msgs: ONIModelMessage[] = [
        { role: "user", content: "a".repeat(100) },
        { role: "assistant", content: "b".repeat(100) },
      ];

      const result = await compactor.compact(msgs);

      expect(model.chat).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toContain("This is a compacted summary of the conversation.");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toBe("Context loaded.");
    });

    it("falls back to truncation on model error", async () => {
      const model = createMockModel({ error: true });
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 100,
        charsPerToken: 1,
      });

      const msgs: ONIModelMessage[] = [
        { role: "user", content: "a".repeat(100) },
        { role: "assistant", content: "b".repeat(100) },
      ];

      const result = await compactor.compact(msgs);

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toContain("conversation was truncated");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toBe("Context loaded.");
    });

    it("passes compactInstructions to the model", async () => {
      const model = createMockModel({
        content: "<summary>Custom summary</summary>",
      });
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 100,
        charsPerToken: 1,
        compactInstructions: "Focus on code changes only.",
      });

      const msgs: ONIModelMessage[] = [
        { role: "user", content: "a".repeat(100) },
        { role: "assistant", content: "b".repeat(100) },
      ];

      await compactor.compact(msgs);

      const chatCall = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const systemOrUser = chatCall.messages.find(
        (m: ONIModelMessage) =>
          typeof m.content === "string" && m.content.includes("Focus on code changes only."),
      );
      expect(systemOrUser).toBeDefined();
    });

    it("returns messages as-is when below threshold", async () => {
      const model = createMockModel();
      const compactor = new ContextCompactor({
        summaryModel: model,
        maxTokens: 10_000,
        charsPerToken: 1,
      });

      const msgs: ONIModelMessage[] = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ];

      const result = await compactor.compact(msgs);

      expect(result).toEqual(msgs);
      expect(model.chat).not.toHaveBeenCalled();
    });
  });
});
