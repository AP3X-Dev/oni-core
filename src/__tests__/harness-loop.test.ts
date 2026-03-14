import { describe, it, expect, vi } from "vitest";
import type {
  ONIModel,
  ONIModelMessage,
  ONIModelToolCall,
  ChatResponse,
} from "../models/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type {
  AgentLoopConfig,
  LoopMessage,
} from "../harness/types.js";
import { agentLoop, wrapWithAgentLoop } from "../harness/agent-loop.js";
import { HooksEngine } from "../harness/hooks-engine.js";
import { TodoModule } from "../harness/todo-module.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function createMockModel(responses: ChatResponse[]): ONIModel {
  let callIdx = 0;
  return {
    chat: vi.fn().mockImplementation(async () => {
      return responses[callIdx++] ?? responses[responses.length - 1]!;
    }),
    stream: vi.fn(),
    provider: "mock",
    modelId: "mock",
    capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
  };
}

function textResponse(content: string): ChatResponse {
  return { content, usage: { inputTokens: 10, outputTokens: 10 }, stopReason: "end" };
}

function toolCallResponse(content: string, toolCalls: ONIModelToolCall[]): ChatResponse {
  return { content, toolCalls, usage: { inputTokens: 10, outputTokens: 10 }, stopReason: "tool_use" };
}

function createEchoTool(): ToolDefinition {
  return {
    name: "Echo",
    description: "Echoes input",
    schema: { type: "object", properties: { text: { type: "string" } } },
    execute: vi.fn((input: { text: string }) => `echoed: ${input.text}`),
  };
}

function baseConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    model: createMockModel([textResponse("Hello!")]),
    tools: [],
    agentName: "test-agent",
    systemPrompt: "You are a test agent.",
    maxTurns: 10,
    ...overrides,
  };
}

async function collectMessages(gen: AsyncGenerator<LoopMessage>): Promise<LoopMessage[]> {
  const msgs: LoopMessage[] = [];
  for await (const msg of gen) {
    msgs.push(msg);
  }
  return msgs;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("agentLoop", () => {
  // ── 1. yields init, assistant, result for text-only response ───────

  it("yields init, assistant, result for text-only response", async () => {
    const model = createMockModel([textResponse("Final answer")]);
    const config = baseConfig({ model });

    const msgs = await collectMessages(agentLoop("What is 2+2?", config));

    const types = msgs.map((m) => m.type);
    expect(types).toContain("system");
    expect(types).toContain("assistant");
    expect(types).toContain("result");

    const initMsg = msgs.find((m) => m.type === "system" && m.subtype === "init");
    expect(initMsg).toBeDefined();

    const assistantMsg = msgs.find((m) => m.type === "assistant");
    expect(assistantMsg?.content).toBe("Final answer");

    const resultMsg = msgs.find((m) => m.type === "result");
    expect(resultMsg?.content).toBe("Final answer");
  });

  // ── 2. executes tool calls and loops until text-only response ──────

  it("executes tool calls and loops until text-only response", async () => {
    const echoTool = createEchoTool();
    const model = createMockModel([
      toolCallResponse("Let me echo that.", [
        { id: "tc_1", name: "Echo", args: { text: "hello" } },
      ]),
      textResponse("Done echoing."),
    ]);

    const config = baseConfig({ model, tools: [echoTool] });
    const msgs = await collectMessages(agentLoop("Echo hello", config));

    // Tool should have been called
    expect(echoTool.execute).toHaveBeenCalledOnce();
    expect((echoTool.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual({ text: "hello" });

    // Should have tool_result message
    const toolResultMsg = msgs.find((m) => m.type === "tool_result");
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.toolResults).toHaveLength(1);
    expect(toolResultMsg!.toolResults![0]!.content).toBe("echoed: hello");

    // Should end with result
    const resultMsg = msgs.find((m) => m.type === "result");
    expect(resultMsg?.content).toBe("Done echoing.");

    const toolStartMsgs = msgs.filter((m) => m.type === "tool_start");
    expect(toolStartMsgs).toHaveLength(1);
    expect(toolStartMsgs[0]?.metadata?.toolName).toBe("Echo");

    // Model should have been called twice
    expect(model.chat).toHaveBeenCalledTimes(2);
  });

  // ── 3. handles unknown tool gracefully ─────────────────────────────

  it("handles unknown tool gracefully", async () => {
    const model = createMockModel([
      toolCallResponse("Using tool.", [
        { id: "tc_1", name: "NonExistent", args: {} },
      ]),
      textResponse("Ok, done."),
    ]);

    const config = baseConfig({ model });
    const msgs = await collectMessages(agentLoop("Do something", config));

    const toolResultMsg = msgs.find((m) => m.type === "tool_result");
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.toolResults![0]!.isError).toBe(true);
    expect(toolResultMsg!.toolResults![0]!.content).toContain("NonExistent");
  });

  // ── 4. respects maxTurns limit ─────────────────────────────────────

  it("respects maxTurns limit", async () => {
    const echoTool = createEchoTool();
    // Model always returns tool calls — never stops
    const model = createMockModel([
      toolCallResponse("Using tool.", [
        { id: "tc_1", name: "Echo", args: { text: "loop" } },
      ]),
    ]);

    const config = baseConfig({ model, tools: [echoTool], maxTurns: 2 });
    const msgs = await collectMessages(agentLoop("Loop forever", config));

    const errorMsg = msgs.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.content).toContain("maxTurns");
  });

  // ── 5. injects todo reminder after tool calls ──────────────────────

  it("injects todo reminder after tool calls", async () => {
    const echoTool = createEchoTool();
    const todoModule = new TodoModule("test-session");
    todoModule.write([
      { id: "t1", content: "Fix the bug", status: "in_progress", priority: "high", updatedAt: 0 },
    ]);

    const model = createMockModel([
      toolCallResponse("Using echo.", [
        { id: "tc_1", name: "Echo", args: { text: "hi" } },
      ]),
      textResponse("All done."),
    ]);

    const config = baseConfig({ model, tools: [echoTool], todoModule });
    const msgs = await collectMessages(agentLoop("Do stuff", config));

    const todoReminder = msgs.find((m) => m.type === "system" && m.subtype === "todo_reminder");
    expect(todoReminder).toBeDefined();
  });

  // ── 6. fires hooks during loop (SessionStart, SessionEnd) ──────────

  it("fires hooks during loop (SessionStart, SessionEnd)", async () => {
    const engine = new HooksEngine();
    const fired: string[] = [];

    engine.on("SessionStart", {
      handler: async (_payload) => {
        fired.push("SessionStart");
        return { decision: "allow" };
      },
    });

    engine.on("SessionEnd", {
      handler: async (_payload) => {
        fired.push("SessionEnd");
        return { decision: "allow" };
      },
    });

    const model = createMockModel([textResponse("Hi")]);
    const config = baseConfig({ model, hooksEngine: engine });
    await collectMessages(agentLoop("Hello", config));

    expect(fired).toContain("SessionStart");
    expect(fired).toContain("SessionEnd");
  });

  // ── 7. Stop hook can force continuation ────────────────────────────

  it("Stop hook can force continuation (block → inject feedback → second call)", async () => {
    const engine = new HooksEngine();
    let stopCount = 0;

    engine.on("Stop", {
      handler: async () => {
        stopCount++;
        if (stopCount === 1) {
          return { decision: "block", reason: "Not detailed enough" };
        }
        return { decision: "allow" };
      },
    });

    const model = createMockModel([
      textResponse("Short answer."),
      textResponse("More detailed answer with explanation."),
    ]);

    const config = baseConfig({ model, hooksEngine: engine });
    const msgs = await collectMessages(agentLoop("Explain X", config));

    // Model should be called twice (first blocked, second allowed)
    expect(model.chat).toHaveBeenCalledTimes(2);

    const resultMsg = msgs.find((m) => m.type === "result");
    expect(resultMsg?.content).toBe("More detailed answer with explanation.");
  });

  // ── 8. PreToolUse hook can deny a tool call ────────────────────────

  it("PreToolUse hook can deny a tool call (tool.execute should NOT be called)", async () => {
    const engine = new HooksEngine();

    engine.on("PreToolUse", {
      handler: async (_payload) => {
        return { decision: "deny", reason: "Blocked by policy" };
      },
    });

    const echoTool = createEchoTool();
    const model = createMockModel([
      toolCallResponse("Let me echo.", [
        { id: "tc_1", name: "Echo", args: { text: "secret" } },
      ]),
      textResponse("Ok, tool was blocked."),
    ]);

    const config = baseConfig({ model, tools: [echoTool], hooksEngine: engine });
    const msgs = await collectMessages(agentLoop("Echo secret", config));

    // Tool execute should NOT have been called
    expect(echoTool.execute).not.toHaveBeenCalled();

    // Tool result should show error
    const toolResultMsg = msgs.find((m) => m.type === "tool_result");
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.toolResults![0]!.isError).toBe(true);
    expect(toolResultMsg!.toolResults![0]!.content).toContain("Blocked by policy");
  });

  // ── 9. AbortSignal cancels the loop ────────────────────────────────

  it("AbortSignal cancels the loop", async () => {
    const controller = new AbortController();
    controller.abort(); // Abort immediately

    const model = createMockModel([textResponse("Never reached")]);
    const config = baseConfig({ model, signal: controller.signal });
    const msgs = await collectMessages(agentLoop("Hello", config));

    const errorMsg = msgs.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.content).toContain("abort");

    // Model should not have been called
    expect(model.chat).not.toHaveBeenCalled();
  });

  it("emits compaction lifecycle metadata when context is compacted", async () => {
    const model = createMockModel([textResponse("Done after compaction.")]);
    const compactor = {
      checkCompaction: vi.fn(() => ({
        needed: true,
        estimatedTokens: 150,
        percentUsed: 0.75,
        threshold: 0.68,
        maxTokens: 200,
      })),
      compact: vi.fn(async () => ([
        { role: "user" as const, content: "[Previous conversation was compacted. Summary]" },
        { role: "assistant" as const, content: "Context loaded." },
      ])),
      estimateTokens: vi.fn((msgs: ONIModelMessage[]) => (msgs.length <= 2 ? 40 : 150)),
    };

    const config = baseConfig({
      model,
      compactor: compactor as any,
      initialMessages: [
        { role: "user", content: "Earlier request" },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: "Another request" },
        { role: "assistant", content: "Another answer" },
      ],
    });

    const msgs = await collectMessages(agentLoop("Continue", config));

    const compactStart = msgs.find((m) => m.type === "system" && m.subtype === "compact_start");
    const compactBoundary = msgs.find((m) => m.type === "system" && m.subtype === "compact_boundary");

    expect(compactStart).toBeDefined();
    expect(compactStart?.metadata).toMatchObject({
      beforeCount: 5,
      estimatedTokens: 150,
      threshold: 0.68,
      maxTokens: 200,
    });

    expect(compactBoundary).toBeDefined();
    expect(compactBoundary?.metadata).toMatchObject({
      beforeCount: 5,
      afterCount: 2,
      summarized: true,
      estimatedTokensBefore: 150,
      estimatedTokensAfter: 40,
      threshold: 0.68,
      maxTokens: 200,
    });
  });

  it("emits compact_error and continues the loop when compaction fails", async () => {
    const model = createMockModel([textResponse("Recovered after compaction failure.")]);
    const compactor = {
      checkCompaction: vi.fn(() => ({
        needed: true,
        estimatedTokens: 120,
        percentUsed: 0.6,
        threshold: 0.5,
        maxTokens: 200,
      })),
      compact: vi.fn(async () => {
        throw new Error("summary model exploded");
      }),
      estimateTokens: vi.fn(() => 120),
    };

    const config = baseConfig({
      model,
      compactor: compactor as any,
    });

    const msgs = await collectMessages(agentLoop("Keep going", config));

    const compactError = msgs.find((m) => m.type === "system" && m.subtype === "compact_error");
    const result = msgs.find((m) => m.type === "result");

    expect(compactError?.content).toContain("summary model exploded");
    expect(compactError?.metadata).toMatchObject({
      beforeCount: 1,
      afterCount: 1,
      estimatedTokensBefore: 120,
      threshold: 0.5,
      maxTokens: 200,
    });
    expect(result?.content).toBe("Recovered after compaction failure.");
  });

  // ── 10. wrapWithAgentLoop returns ONI-Core compatible node fn ──────

  it("wrapWithAgentLoop returns ONI-Core compatible node function", async () => {
    const model = createMockModel([textResponse("Task completed successfully")]);
    const config = baseConfig({ model, agentName: "worker" });

    const nodeFn = wrapWithAgentLoop(config);
    expect(typeof nodeFn).toBe("function");

    const result = await nodeFn({ task: "Do the work", agentResults: {} });
    expect(result).toHaveProperty("agentResults");
    expect(result.agentResults).toHaveProperty("worker");
    expect(result.agentResults.worker).toBe("Task completed successfully");
  });
});
