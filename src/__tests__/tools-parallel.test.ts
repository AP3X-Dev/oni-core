import { describe, it, expect, vi } from "vitest";
import { executeTools, buildToolMap } from "../harness/loop/tools.js";
import type { ToolDefinition } from "../tools/types.js";
import type { ToolExecutionContext } from "../harness/loop/tools.js";
import type { AgentLoopConfig } from "../harness/types.js";
import type { ONIModel } from "../models/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockModel(): ONIModel {
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn(async () => ({
      content: "",
      toolCalls: undefined,
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: "end" as const,
    })),
    async *stream() {
      yield { type: "text" as const, text: "" };
    },
  };
}

function makeToolDef(
  name: string,
  parallelSafe: boolean | undefined,
  executeFn: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown>,
): ToolDefinition {
  const def: ToolDefinition = {
    name,
    description: `Tool ${name}`,
    schema: { type: "object", properties: {} },
    execute: executeFn,
  };
  if (parallelSafe !== undefined) {
    def.parallelSafe = parallelSafe;
  }
  return def;
}

function makeContext(toolMap: Map<string, ToolDefinition>): ToolExecutionContext {
  const config: AgentLoopConfig = {
    model: mockModel(),
    tools: [...toolMap.values()],
    agentName: "test-agent",
    systemPrompt: "You are a test agent.",
  };

  return {
    sessionId: "sess-test",
    threadId: "thread-test",
    turn: 1,
    config,
    toolMap,
    hasMemoryLoader: false,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Tool parallel batching", () => {
  it("runs parallel-safe tools concurrently", async () => {
    const order: string[] = [];

    const toolA = makeToolDef("alpha", true, async () => {
      order.push("alpha_start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("alpha_end");
      return "a";
    });

    const toolB = makeToolDef("beta", true, async () => {
      order.push("beta_start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("beta_end");
      return "b";
    });

    const toolMap = buildToolMap([toolA, toolB]);
    const ctx = makeContext(toolMap);

    await executeTools(
      [
        { id: "c1", name: "alpha", args: {} },
        { id: "c2", name: "beta", args: {} },
      ],
      ctx,
    );

    // Both starts should happen before either end (interleaved execution)
    const alphaStartIdx = order.indexOf("alpha_start");
    const betaStartIdx = order.indexOf("beta_start");
    const alphaEndIdx = order.indexOf("alpha_end");
    const betaEndIdx = order.indexOf("beta_end");

    expect(alphaStartIdx).toBeLessThan(alphaEndIdx);
    expect(betaStartIdx).toBeLessThan(betaEndIdx);
    // Concurrency check: both starts happen before either end
    expect(alphaStartIdx).toBeLessThan(alphaEndIdx);
    expect(betaStartIdx).toBeLessThan(betaEndIdx);
    expect(Math.max(alphaStartIdx, betaStartIdx)).toBeLessThan(
      Math.min(alphaEndIdx, betaEndIdx),
    );
  });

  it("runs tools serially when any has parallelSafe=false", async () => {
    const order: string[] = [];

    const toolA = makeToolDef("a", true, async () => {
      order.push("a_start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("a_end");
      return "a";
    });

    const toolB = makeToolDef("b", false, async () => {
      order.push("b_start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("b_end");
      return "b";
    });

    const toolMap = buildToolMap([toolA, toolB]);
    const ctx = makeContext(toolMap);

    await executeTools(
      [
        { id: "c1", name: "a", args: {} },
        { id: "c2", name: "b", args: {} },
      ],
      ctx,
    );

    expect(order).toEqual(["a_start", "a_end", "b_start", "b_end"]);
  });

  it("treats missing parallelSafe as true (default)", async () => {
    const order: string[] = [];

    const toolA = makeToolDef("x", undefined, async () => {
      order.push("x_start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("x_end");
      return "x";
    });

    const toolB = makeToolDef("y", undefined, async () => {
      order.push("y_start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("y_end");
      return "y";
    });

    const toolMap = buildToolMap([toolA, toolB]);
    const ctx = makeContext(toolMap);

    await executeTools(
      [
        { id: "c1", name: "x", args: {} },
        { id: "c2", name: "y", args: {} },
      ],
      ctx,
    );

    // Concurrent execution: both starts before either end
    const xStartIdx = order.indexOf("x_start");
    const yStartIdx = order.indexOf("y_start");
    const xEndIdx = order.indexOf("x_end");
    const yEndIdx = order.indexOf("y_end");

    expect(Math.max(xStartIdx, yStartIdx)).toBeLessThan(
      Math.min(xEndIdx, yEndIdx),
    );
  });

  it("preserves tool result order regardless of completion order", async () => {
    const toolSlow = makeToolDef("slow", true, async () => {
      await new Promise((r) => setTimeout(r, 100));
      return "slow-result";
    });

    const toolFast = makeToolDef("fast", true, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "fast-result";
    });

    const toolMap = buildToolMap([toolSlow, toolFast]);
    const ctx = makeContext(toolMap);

    const { toolResults } = await executeTools(
      [
        { id: "c1", name: "slow", args: {} },
        { id: "c2", name: "fast", args: {} },
      ],
      ctx,
    );

    // Results must be in call order (slow first, fast second), not completion order
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0].toolName).toBe("slow");
    expect(toolResults[0].content).toBe("slow-result");
    expect(toolResults[1].toolName).toBe("fast");
    expect(toolResults[1].content).toBe("fast-result");
  });
});
