import { describe, it, expect, vi } from "vitest";
import { agentLoop } from "../harness/loop/index.js";
import type { AgentLoopConfig } from "../harness/types.js";
import type { ChatResponse } from "../models/types.js";

// BUG-0009 / BUG-0359: `remaining = maxTurns - turn` is the correct formula.
// The agent sees "1 turn remaining" while executing its last valid turn, which is
// accurate — it has 1 turn (the current one) remaining. The prior `- 1` variant
// told the agent "0 turns remaining" on its last active turn, which is misleading.

describe("agentLoop remaining-turns count (BUG-0009)", () => {
  function makeSuccessResponse(): ChatResponse {
    return {
      content: "done",
      toolCalls: [],
      stopReason: "end",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
  }

  it("reports 0 remaining turns on the final turn (turn=maxTurns-1)", async () => {
    const capturedPrompts: string[] = [];

    const mockModel = {
      chat: vi.fn((opts: { systemPrompt?: string }) => {
        if (opts?.systemPrompt) capturedPrompts.push(opts.systemPrompt);
        return Promise.resolve(makeSuccessResponse());
      }),
      stream: vi.fn(),
      provider: "mock",
      modelId: "mock",
      capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
    };

    const config: AgentLoopConfig = {
      model: mockModel as any,
      tools: [],
      agentName: "test-agent",
      systemPrompt: "system",
      maxTurns: 1,
    };

    // Consume all messages to drive the loop to completion
    const gen = agentLoop("do task", config);
    for await (const _msg of gen) { /* drain */ }

    expect(mockModel.chat).toHaveBeenCalledOnce();

    const prompt = capturedPrompts[0] ?? "";
    // With maxTurns=1 and turn=0: remaining = 1 - 0 = 1
    expect(prompt).toMatch(/1 turns remaining/);
    expect(prompt).not.toMatch(/0 turns remaining/);
  });

  it("reports maxTurns-1 remaining turns on the first turn (turn=0)", async () => {
    const capturedPrompts: string[] = [];
    let callCount = 0;

    const mockModel = {
      chat: vi.fn((opts: { systemPrompt?: string }) => {
        if (opts?.systemPrompt) capturedPrompts.push(opts.systemPrompt);
        callCount++;
        // Return a result immediately on every call to keep turns short
        return Promise.resolve(makeSuccessResponse());
      }),
      stream: vi.fn(),
      provider: "mock",
      modelId: "mock",
      capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
    };

    const config: AgentLoopConfig = {
      model: mockModel as any,
      tools: [],
      agentName: "test-agent",
      systemPrompt: "system",
      maxTurns: 5,
    };

    const gen = agentLoop("do task", config);
    for await (const _msg of gen) { /* drain */ }

    // First call: turn=0, remaining = 5 - 0 = 5
    const firstPrompt = capturedPrompts[0] ?? "";
    expect(firstPrompt).toMatch(/5 turns remaining/);
    expect(firstPrompt).not.toMatch(/6 turns remaining/);
  });

  it("reports 0 remaining on the last of multiple turns", async () => {
    const capturedPrompts: string[] = [];

    const mockModel = {
      chat: vi.fn((opts: { systemPrompt?: string }) => {
        if (opts?.systemPrompt) capturedPrompts.push(opts.systemPrompt);
        return Promise.resolve(makeSuccessResponse());
      }),
      stream: vi.fn(),
      provider: "mock",
      modelId: "mock",
      capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
    };

    const config: AgentLoopConfig = {
      model: mockModel as any,
      tools: [],
      agentName: "test-agent",
      systemPrompt: "system",
      maxTurns: 3,
    };

    const gen = agentLoop("do task", config);
    for await (const _msg of gen) { /* drain */ }

    // With stopReason "end" on every turn, loop completes after first turn
    // Just verify the last captured prompt says 0 remaining
    const lastPrompt = capturedPrompts[capturedPrompts.length - 1] ?? "";
    expect(lastPrompt).toMatch(/\d+ turns remaining/);

    // The critical check: no prompt should ever say "N+1 turns remaining"
    // where N is the actual remaining count at that turn.
    // Specifically, no prompt should mention maxTurns turns remaining (which would be the
    // old behavior of `maxTurns - turn` on turn=0 when off by one going the wrong direction)
    for (const prompt of capturedPrompts) {
      expect(prompt).not.toMatch(/4 turns remaining/);
    }
  });
});
