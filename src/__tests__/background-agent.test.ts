import { describe, it, expect, vi } from "vitest";
import { spawnAgent } from "../harness/background-agent.js";
import type { AgentLoopConfig } from "../harness/types.js";
import type { LoopMessage } from "../harness/types.js";

interface MockResponse {
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
}

function makeMockConfig(responses: MockResponse[]): AgentLoopConfig {
  let index = 0;
  return {
    model: {
      provider: "mock",
      modelId: "mock",
      capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
      chat: vi.fn(async () => {
        const resp = responses[index % responses.length];
        index++;
        return {
          content: resp.content,
          toolCalls: resp.toolCalls ?? [],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: resp.toolCalls ? "tool_use" : "end_turn",
        };
      }),
      stream: vi.fn(),
    } as any,
    tools: [],
    agentName: "test-agent",
    systemPrompt: "You are a test agent.",
  };
}

describe("spawnAgent", () => {
  it("returns a handle immediately", () => {
    const config = makeMockConfig([{ content: "Done." }]);
    const handle = spawnAgent({ prompt: "hello", config });

    expect(handle.id).toBeDefined();
    expect(typeof handle.id).toBe("string");
    expect(handle.status).toBe("running");
    expect(handle.result).toBeInstanceOf(Promise);
  });

  it("resolves result when agent completes", async () => {
    const config = makeMockConfig([{ content: "Final answer." }]);
    const handle = spawnAgent({ prompt: "do something", config });

    const result = await handle.result;
    expect(result).toBe("Final answer.");
    expect(handle.status).toBe("completed");
  });

  it("emits events to subscribers", async () => {
    const config = makeMockConfig([{ content: "Hello world." }]);
    const handle = spawnAgent({ prompt: "test events", config });

    const events: LoopMessage[] = [];
    handle.onEvent((evt) => events.push(evt));

    await handle.result;

    const types = events.map((e) => e.type);
    expect(types).toContain("system");
    expect(types).toContain("assistant");
    expect(types).toContain("result");
  });

  it("cancel aborts the agent", async () => {
    // Use a tool that respects the abort signal
    const slowTool = {
      name: "slow_tool",
      description: "A slow tool",
      parameters: { type: "object", properties: {} },
      execute: async (_args: Record<string, unknown>, ctx: any) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 60_000);
          const signal = ctx?.signal as AbortSignal | undefined;
          if (signal) {
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("aborted"));
            });
          }
        });
        return { content: "done" };
      },
    };

    const config = makeMockConfig([
      {
        content: "Using tool.",
        toolCalls: [{ id: "tc1", name: "slow_tool", args: {} }],
      },
      { content: "Finished." },
    ]);
    config.tools = [slowTool as any];
    config.maxTurns = 5;

    const handle = spawnAgent({ prompt: "use slow tool", config });

    // Give it a moment to start, then cancel
    await new Promise((resolve) => setTimeout(resolve, 50));
    handle.cancel();

    await expect(handle.result).rejects.toThrow(/cancel/i);
    expect(handle.status).toBe("cancelled");
  }, 10_000);

  it("send injects messages via messageQueue", async () => {
    const config = makeMockConfig([{ content: "All done." }]);
    const handle = spawnAgent({ prompt: "test send", config });

    handle.send("extra message");

    const result = await handle.result;
    expect(result).toBe("All done.");
    // Agent should complete without crashing despite the injected message
    expect(handle.status).toBe("completed");
  });

  it("uses custom id when provided", () => {
    const config = makeMockConfig([{ content: "Done." }]);
    const handle = spawnAgent({ prompt: "hello", config, id: "custom-id" });

    expect(handle.id).toBe("custom-id");
  });
});
