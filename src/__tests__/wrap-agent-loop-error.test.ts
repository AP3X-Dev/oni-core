import { describe, it, expect, vi } from "vitest";
import { wrapWithAgentLoop } from "../harness/agent-loop.js";
import type { AgentLoopConfig } from "../harness/types.js";

describe("wrapWithAgentLoop", () => {
  it("BUG-0003: should throw when agent loop errors instead of returning empty string", async () => {
    const failingModel = {
      chat: vi.fn().mockRejectedValue(new Error("model crashed")),
      stream: vi.fn(),
      provider: "mock",
      modelId: "mock",
      capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
    };

    const config: AgentLoopConfig = {
      model: failingModel as any,
      tools: [],
      agentName: "failing-agent",
      systemPrompt: "test",
      maxTurns: 1,
    };

    const nodeFn = wrapWithAgentLoop(config);

    await expect(
      nodeFn({ task: "do something", agentResults: {} }),
    ).rejects.toThrow(/failing-agent/);
  });
});
