import { describe, it, expect, vi } from "vitest";
import { defineAgent } from "../agents/define-agent.js";
import type { ONIModel, ChatResponse, ONIModelMessage } from "../models/types.js";
import type { ToolDefinition } from "../tools/types.js";

// ---- Helpers ----

function makeMockModel(responses: ChatResponse[]): ONIModel {
  let callIndex = 0;
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn(async () => {
      const resp = responses[callIndex];
      if (!resp) throw new Error(`No more mock responses (call #${callIndex})`);
      callIndex++;
      return resp;
    }),
    async *stream() {
      yield { type: "text" as const, text: "chunk" };
    },
  };
}

describe("defineAgent", () => {
  it("creates an AgentNode with correct metadata", () => {
    const model = makeMockModel([]);
    const agent = defineAgent({
      name: "myAgent",
      description: "A test agent",
      model,
      systemPrompt: "You are helpful.",
      maxSteps: 5,
      maxTokens: 1000,
    });

    expect(agent.name).toBe("myAgent");
    expect(agent.description).toBe("A test agent");
    expect(agent.model).toBe(model);
    expect(agent.systemPrompt).toBe("You are helpful.");
    expect(agent.maxSteps).toBe(5);
    expect(agent.maxTokens).toBe(1000);
    expect(agent.tools).toEqual([]);
    expect(agent._isAgent).toBe(true);
    expect(typeof agent._nodeFn).toBe("function");
  });

  it("runs simple chat (no tools) and returns messages", async () => {
    const model = makeMockModel([
      {
        content: "Hello, I can help!",
        usage: { inputTokens: 10, outputTokens: 8 },
        stopReason: "end",
      },
    ]);

    const agent = defineAgent({ name: "chatAgent", model });
    const result = await agent._nodeFn({}, {});

    expect(result.messages).toBeDefined();
    expect(result.messages).toHaveLength(1);
    expect(result.messages![0]!.role).toBe("assistant");
    expect(result.messages![0]!.content).toBe("Hello, I can help!");
    expect(model.chat).toHaveBeenCalledTimes(1);

    // Verify systemPrompt was passed (undefined here since not set)
    const chatArgs = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    expect(chatArgs.systemPrompt).toBeUndefined();
  });

  it("runs ReAct loop: chat -> tool -> chat", async () => {
    const calculator: ToolDefinition = {
      name: "calculator",
      description: "Math tool",
      schema: { type: "object", properties: { expr: { type: "string" } } },
      execute: async (input: { expr: string }) => {
        if (input.expr === "2+2") return 4;
        return 0;
      },
    };

    const model = makeMockModel([
      // Step 1: model calls calculator tool
      {
        content: "Let me calculate that.",
        toolCalls: [{ id: "tc-1", name: "calculator", args: { expr: "2+2" } }],
        usage: { inputTokens: 20, outputTokens: 15 },
        stopReason: "tool_use",
      },
      // Step 2: model gives final answer after tool result
      {
        content: "2 + 2 = 4",
        usage: { inputTokens: 30, outputTokens: 10 },
        stopReason: "end",
      },
    ]);

    const agent = defineAgent({
      name: "reactAgent",
      model,
      tools: [calculator],
      systemPrompt: "You are a calculator.",
    });

    const result = await agent._nodeFn({}, {});

    // Should have: assistant (with tool call) + tool result + assistant (final)
    expect(result.messages).toHaveLength(3);
    expect(result.messages![0]!.role).toBe("assistant");
    expect(result.messages![0]!.toolCalls).toHaveLength(1);
    expect(result.messages![1]!.role).toBe("tool");
    expect(result.messages![1]!.content).toBe("4");
    expect(result.messages![1]!.toolCallId).toBe("tc-1");
    expect(result.messages![2]!.role).toBe("assistant");
    expect(result.messages![2]!.content).toBe("2 + 2 = 4");

    expect(model.chat).toHaveBeenCalledTimes(2);

    // Verify systemPrompt and tools were passed
    const firstCall = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    expect(firstCall.systemPrompt).toBe("You are a calculator.");
    expect(firstCall.tools).toHaveLength(1);
    expect(firstCall.tools![0]!.name).toBe("calculator");
  });

  it("respects maxSteps limit", async () => {
    // Model always returns a tool call, so the loop would run forever
    // without maxSteps
    const tool: ToolDefinition = {
      name: "ping",
      description: "Pings",
      schema: { type: "object" },
      execute: async () => "pong",
    };

    const responses: ChatResponse[] = [];
    for (let i = 0; i < 20; i++) {
      responses.push({
        content: `Step ${i}`,
        toolCalls: [{ id: `tc-${i}`, name: "ping", args: {} }],
        usage: { inputTokens: 5, outputTokens: 5 },
        stopReason: "tool_use",
      });
    }

    const model = makeMockModel(responses);
    const agent = defineAgent({
      name: "loopAgent",
      model,
      tools: [tool],
      maxSteps: 3,
    });

    const result = await agent._nodeFn({}, {});

    // 3 iterations: each produces assistant + tool = 6 messages
    expect(model.chat).toHaveBeenCalledTimes(3);
    expect(result.messages).toHaveLength(6);
  });

  it("respects maxTokens budget", async () => {
    // Each response uses 100 tokens. Budget is 250 so we should get 3 calls max
    // (after 3rd call: 300 total >= 250 budget).
    const tool: ToolDefinition = {
      name: "noop",
      description: "No-op",
      schema: { type: "object" },
      execute: async () => "ok",
    };

    const responses: ChatResponse[] = [];
    for (let i = 0; i < 20; i++) {
      responses.push({
        content: `Response ${i}`,
        toolCalls: [{ id: `tc-${i}`, name: "noop", args: {} }],
        usage: { inputTokens: 50, outputTokens: 50 },
        stopReason: "tool_use",
      });
    }

    const model = makeMockModel(responses);
    const agent = defineAgent({
      name: "budgetAgent",
      model,
      tools: [tool],
      maxSteps: 20,
      maxTokens: 250,
    });

    const result = await agent._nodeFn({}, {});

    // After 3 calls: 300 tokens total >= 250 budget, should stop
    // 3rd call produces assistant message, then budget check triggers break
    // before executing tools on step 3
    expect(model.chat).toHaveBeenCalledTimes(3);
    // Steps 1 and 2: assistant + tool each = 4. Step 3: assistant only = 1. Total = 5
    expect(result.messages).toHaveLength(5);
  });

  it("seeds messages from state.messages", async () => {
    const model = makeMockModel([
      {
        content: "I see your previous message.",
        usage: { inputTokens: 15, outputTokens: 10 },
        stopReason: "end",
      },
    ]);

    const agent = defineAgent({ name: "seeded", model });

    const existingMessages: ONIModelMessage[] = [
      { role: "user", content: "Hello from earlier" },
    ];

    const result = await agent._nodeFn(
      { messages: existingMessages } as Record<string, unknown>,
      {},
    );

    // model.chat should have received the existing messages as part of the conversation
    // Note: the messages array is mutated after chat() returns (assistant message pushed),
    // so we verify the model was called once and the first message is our seeded one.
    expect(model.chat).toHaveBeenCalledTimes(1);
    const chatArgs = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0]!;
    expect(chatArgs.messages[0]!.role).toBe("user");
    expect(chatArgs.messages[0]!.content).toBe("Hello from earlier");

    // Result should only contain NEW messages (not the seeded ones)
    expect(result.messages).toHaveLength(1);
    expect(result.messages![0]!.content).toBe("I see your previous message.");
  });
});
