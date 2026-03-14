import { describe, it, expect, vi } from "vitest";
import { buildAgentContext } from "../agents/context.js";
import type { ONIModel, ONIModelMessage } from "../models/types.js";
import type { ToolDefinition } from "../tools/types.js";

// ---- Helpers ----

function mockModel(overrides: Partial<ONIModel> = {}): ONIModel {
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn(async () => ({
      content: "Hello!",
      toolCalls: undefined,
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "end" as const,
    })),
    async *stream() {
      yield { type: "text" as const, text: "Hi" };
    },
    ...overrides,
  };
}

function noopCallbacks() {
  return {
    onSend: vi.fn(),
    getInbox: vi.fn(() => []),
    onRequest: vi.fn(async () => undefined),
    onReply: vi.fn(),
    onPublish: vi.fn(),
  };
}

describe("AgentContext (buildAgentContext)", () => {
  it("chat() delegates to model with system prompt and tools", async () => {
    const model = mockModel();
    const tool: ToolDefinition = {
      name: "calculator",
      description: "Does math",
      schema: { type: "object", properties: { expr: { type: "string" } } },
      execute: async (input: { expr: string }) => eval(input.expr),
    };

    const ctx = buildAgentContext({
      model,
      tools: [tool],
      agentName: "mathAgent",
      systemPrompt: "You are a calculator.",
      config: { threadId: "t1" },
      store: null,
      state: { counter: 0 },
      streamWriter: null,
      remainingSteps: 10,
      ...noopCallbacks(),
    });

    const messages: ONIModelMessage[] = [{ role: "user", content: "What is 2+2?" }];
    const response = await ctx.chat(messages);

    expect(response.content).toBe("Hello!");
    expect(model.chat).toHaveBeenCalledTimes(1);

    const chatArgs = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    expect(chatArgs.messages).toEqual(messages);
    expect(chatArgs.systemPrompt).toBe("You are a calculator.");
    expect(chatArgs.tools).toHaveLength(1);
    expect(chatArgs.tools![0]!.name).toBe("calculator");
    expect(chatArgs.tools![0]!.description).toBe("Does math");
    expect(chatArgs.tools![0]!.parameters).toEqual(tool.schema);
  });

  it("exposes runtime context", () => {
    const ctx = buildAgentContext({
      agentName: "testAgent",
      config: { threadId: "t-42", metadata: { env: "test" } },
      store: null,
      state: { count: 7 },
      streamWriter: null,
      remainingSteps: 5,
      ...noopCallbacks(),
    });

    expect(ctx.agentName).toBe("testAgent");
    expect(ctx.config.threadId).toBe("t-42");
    expect(ctx.config.metadata).toEqual({ env: "test" });
    expect(ctx.state).toEqual({ count: 7 });
    expect(ctx.remainingSteps).toBe(5);
    expect(ctx.store).toBeNull();
    expect(ctx.streamWriter).toBeNull();
  });

  it("send() delegates to onSend callback", () => {
    const callbacks = noopCallbacks();
    const ctx = buildAgentContext({
      agentName: "sender",
      config: {},
      store: null,
      state: {},
      streamWriter: null,
      remainingSteps: 10,
      ...callbacks,
    });

    ctx.send("receiverAgent", { task: "process" });

    expect(callbacks.onSend).toHaveBeenCalledTimes(1);
    expect(callbacks.onSend).toHaveBeenCalledWith("receiverAgent", { task: "process" });
  });

  it("executeTools() runs tools with manual ToolContext", async () => {
    const executeSpy = vi.fn(async (input: { x: number }) => input.x * 2);
    const tool: ToolDefinition = {
      name: "double",
      description: "Doubles a number",
      schema: { type: "object", properties: { x: { type: "number" } } },
      execute: executeSpy,
    };

    const ctx = buildAgentContext({
      model: mockModel(),
      tools: [tool],
      agentName: "toolAgent",
      config: { threadId: "t1" },
      store: null,
      state: { val: 10 },
      streamWriter: null,
      remainingSteps: 8,
      ...noopCallbacks(),
    });

    const results = await ctx.executeTools([
      { id: "call-1", name: "double", args: { x: 21 } },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.toolCallId).toBe("call-1");
    expect(results[0]!.name).toBe("double");
    expect(results[0]!.result).toBe(42);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("executeTools() returns error for unknown tool", async () => {
    const ctx = buildAgentContext({
      model: mockModel(),
      tools: [],
      agentName: "emptyAgent",
      config: {},
      store: null,
      state: {},
      streamWriter: null,
      remainingSteps: 10,
      ...noopCallbacks(),
    });

    const results = await ctx.executeTools([
      { id: "call-x", name: "nonexistent", args: {} },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.isError).toBe(true);
    expect(results[0]!.result).toContain("nonexistent");
  });

  it("throws helpful error when calling chat without model", async () => {
    const ctx = buildAgentContext({
      agentName: "noModelAgent",
      config: {},
      store: null,
      state: {},
      streamWriter: null,
      remainingSteps: 10,
      ...noopCallbacks(),
    });

    await expect(ctx.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /no model configured/i,
    );
  });
});
