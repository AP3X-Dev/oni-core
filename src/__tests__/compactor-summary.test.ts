import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextCompactor } from "../harness/context-compactor.js";
import type { ONIModel } from "../models/types.js";

function makeMockModel(summaryResponse: string): ONIModel {
  return {
    chat: vi.fn().mockResolvedValue({
      content: `<summary>${summaryResponse}</summary>`,
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
  } as unknown as ONIModel;
}

describe("ContextCompactor.getLastSummary()", () => {
  it("returns null before any compaction", () => {
    const compactor = new ContextCompactor({
      summaryModel: makeMockModel(""),
    });
    expect(compactor.getLastSummary()).toBeNull();
  });

  it("returns the summary text after compaction", async () => {
    const compactor = new ContextCompactor({
      summaryModel: makeMockModel("This is a summary of the session."),
      threshold: 0,
    });
    const messages = [
      { role: "user" as const, content: "x".repeat(1000) },
      { role: "assistant" as const, content: "response" },
    ];
    await compactor.compact(messages, { skipInitialCheck: true });
    expect(compactor.getLastSummary()).toBe("This is a summary of the session.");
  });
});

describe("ContextCompactor.getOpenThreads()", () => {
  it("returns empty array before compaction", () => {
    const compactor = new ContextCompactor({
      summaryModel: makeMockModel(""),
    });
    expect(compactor.getOpenThreads()).toEqual([]);
  });

  it("extracts lines with open-thread markers", async () => {
    const summary = `Completed the login feature.\nTODO: Fix the signup form validation.\nPending: Deploy to staging.`;
    const compactor = new ContextCompactor({
      summaryModel: makeMockModel(summary),
      threshold: 0,
    });
    const messages = [
      { role: "user" as const, content: "x".repeat(1000) },
      { role: "assistant" as const, content: "y" },
    ];
    await compactor.compact(messages, { skipInitialCheck: true });
    const threads = compactor.getOpenThreads();
    expect(threads.some(t => t.includes("TODO"))).toBe(true);
    expect(threads.some(t => t.includes("Pending"))).toBe(true);
  });
});
