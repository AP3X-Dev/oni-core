import { describe, it, expect, vi } from "vitest";
import type {
  ONIModel,
  ChatResponse,
} from "../models/types.js";
import type { AgentLoopConfig } from "../harness/types.js";
import { agentLoop } from "../harness/agent-loop.js";
import { HooksEngine } from "../harness/hooks-engine.js";

/**
 * Regression test for BUG-0429: fireSessionEnd() was called bare in the
 * finally block of agentLoop — a throwing session-end hook propagated out of
 * the generator and masked the real session outcome.
 *
 * Fix: wrap fireSessionEnd in try/catch in the finally block so hook errors
 * are swallowed (logged as warnings) and the generator completes normally.
 */

function createMockModel(responses: ChatResponse[]): ONIModel {
  let idx = 0;
  return {
    chat: vi.fn().mockImplementation(async () => responses[idx++] ?? responses[responses.length - 1]!),
    stream: vi.fn(),
    provider: "mock",
    modelId: "mock",
    capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
  };
}

function textResponse(content: string): ChatResponse {
  return { content, usage: { inputTokens: 10, outputTokens: 10 }, stopReason: "end" };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("BUG-0429: fireSessionEnd hook throwing does not mask session outcome", () => {
  it("BUG-0429: generator completes normally when SessionEnd hook throws", async () => {
    const engine = new HooksEngine();
    // Register a SessionEnd hook that always throws.
    engine.on("SessionEnd", {
      handler: vi.fn().mockRejectedValue(new Error("session-end hook failure")),
    });

    const config: AgentLoopConfig = {
      model: createMockModel([textResponse("Done!")]),
      tools: [],
      agentName: "test-agent",
      systemPrompt: "You are a test agent.",
      maxTurns: 1,
      hooksEngine: engine,
    };

    // Before the fix this would throw; after the fix it must resolve with messages.
    const messages = await collect(agentLoop("hello", config));

    // The generator must yield at least one message and not throw.
    expect(messages.length).toBeGreaterThan(0);
    // The final message must reflect successful completion, not a hook error.
    const types = messages.map((m) => (m as { type: string }).type);
    expect(types).not.toContain("error");
  });

  it("BUG-0429: generator still yields correct response content when SessionEnd hook throws", async () => {
    const engine = new HooksEngine();
    engine.on("SessionEnd", {
      handler: vi.fn().mockRejectedValue(new Error("hook boom")),
    });

    const config: AgentLoopConfig = {
      model: createMockModel([textResponse("Agent response text")]),
      tools: [],
      agentName: "test-agent",
      systemPrompt: "You are a test agent.",
      maxTurns: 1,
      hooksEngine: engine,
    };

    const messages = await collect(agentLoop("ping", config));

    // The response content must be present in one of the yielded messages.
    const contents = messages
      .map((m) => (m as { content?: unknown }).content)
      .filter(Boolean);
    const hasResponse = contents.some(
      (c) => typeof c === "string" && c.includes("Agent response text")
    );
    expect(hasResponse).toBe(true);
  });

  it("BUG-0429: for-await-of loop is not aborted when SessionEnd hook throws", async () => {
    const engine = new HooksEngine();
    engine.on("SessionEnd", {
      handler: vi.fn().mockRejectedValue(new Error("abort hook")),
    });

    const config: AgentLoopConfig = {
      model: createMockModel([textResponse("ok"), textResponse("ok2")]),
      tools: [],
      agentName: "test-agent",
      systemPrompt: "You are a test agent.",
      maxTurns: 2,
      hooksEngine: engine,
    };

    // This must NOT throw — before the fix it would propagate the hook error.
    let threw = false;
    try {
      await collect(agentLoop("test", config));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
