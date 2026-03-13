import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ONIModel,
  ChatResponse,
  ChatParams,
} from "../models/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { LoopMessage, AgentNodeConfig } from "../harness/types.js";
import { ONIHarness } from "../harness/harness.js";
import type { SwarmAgentCompat } from "../harness/harness.js";
import { TodoModule } from "../harness/todo-module.js";
import { HooksEngine } from "../harness/hooks-engine.js";
import { SkillLoader } from "../harness/skill-loader.js";

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

async function collectMessages(gen: AsyncGenerator<LoopMessage>): Promise<LoopMessage[]> {
  const msgs: LoopMessage[] = [];
  for await (const msg of gen) {
    msgs.push(msg);
  }
  return msgs;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("ONIHarness", () => {
  let model: ONIModel;

  beforeEach(() => {
    model = createMockModel([textResponse("Final answer")]);
  });

  // ── 1. creates via ONIHarness.create() ──────────────────────────────

  it("creates via ONIHarness.create()", () => {
    const harness = ONIHarness.create({ model });
    expect(harness).toBeInstanceOf(ONIHarness);
  });

  // ── 2. runToResult() returns the final text ─────────────────────────

  it("runToResult() returns the final text", async () => {
    const harness = ONIHarness.create({ model });
    const result = await harness.runToResult("Hello", { name: "test-agent" });
    expect(result).toBe("Final answer");
  });

  // ── 3. run() yields typed messages (system, assistant, result) ──────

  it("run() yields typed messages (system, assistant, result)", async () => {
    const harness = ONIHarness.create({ model });
    const msgs = await collectMessages(harness.run("Hello", { name: "test-agent" }));

    const types = msgs.map((m) => m.type);
    expect(types).toContain("system");
    expect(types).toContain("assistant");
    expect(types).toContain("result");
  });

  // ── 4. asNode() returns an ONI-Core compatible node function ────────

  it("asNode() returns an ONI-Core compatible node function", async () => {
    const harness = ONIHarness.create({ model });
    const nodeFn = harness.asNode({ name: "worker" });

    expect(typeof nodeFn).toBe("function");

    const result = await nodeFn({ task: "Do the work", agentResults: {} });
    expect(result).toHaveProperty("agentResults");
    expect(result.agentResults).toHaveProperty("worker");
    expect(result.agentResults!.worker).toBe("Final answer");
  });

  // ── 5. asSwarmAgent() returns SwarmAgentCompat object ───────────────

  it("asSwarmAgent() returns SwarmAgentCompat object", async () => {
    const harness = ONIHarness.create({ model });
    const agent = harness.asSwarmAgent("planner", "You are a planner.", undefined, {
      description: "Plans tasks",
      capabilities: ["planning", "analysis"],
    });

    expect(agent.name).toBe("planner");
    expect(agent.description).toBe("Plans tasks");
    expect(agent.capabilities).toEqual(["planning", "analysis"]);
    expect(typeof agent.handler).toBe("function");

    // Handler should work as an ONI-Core node function
    const result = await agent.handler({ task: "Plan something", agentResults: {} });
    expect(result).toHaveProperty("agentResults");
  });

  // ── 6. includes TodoWrite, TodoRead, and Skill in agent tools ──────

  it("includes TodoWrite, TodoRead, and Skill in agent tools", async () => {
    const harness = ONIHarness.create({ model });

    // Run a prompt and capture ChatParams to inspect tools
    await harness.runToResult("Hello", { name: "test-agent" });

    const chatCall = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ChatParams;
    const toolNames = chatCall.tools?.map((t) => t.name) ?? [];

    expect(toolNames).toContain("TodoWrite");
    expect(toolNames).toContain("TodoRead");
    expect(toolNames).toContain("Skill");
  });

  // ── 7. getTodoModule() returns the working memory module ────────────

  it("getTodoModule() returns the working memory module", () => {
    const harness = ONIHarness.create({ model });
    const todoModule = harness.getTodoModule();
    expect(todoModule).toBeInstanceOf(TodoModule);

    // Should be functional
    todoModule.write([
      { id: "t1", content: "Test task", status: "pending", priority: "medium", updatedAt: 0 },
    ]);
    expect(todoModule.getState().todos).toHaveLength(1);
  });

  // ── 8. getHooksEngine() returns the hooks engine ────────────────────

  it("getHooksEngine() returns the hooks engine", () => {
    const harness = ONIHarness.create({ model });
    const engine = harness.getHooksEngine();
    expect(engine).toBeInstanceOf(HooksEngine);
  });

  // ── 9. addHooks() adds hooks at runtime ─────────────────────────────

  it("addHooks() adds hooks at runtime", async () => {
    const fired: string[] = [];
    const harness = ONIHarness.create({ model });

    harness.addHooks({
      SessionStart: [
        {
          handler: async () => {
            fired.push("SessionStart");
            return { decision: "allow" };
          },
        },
      ],
    });

    await harness.runToResult("Hello", { name: "test-agent" });
    expect(fired).toContain("SessionStart");
  });

  // ── 10. registerSkill() adds skills at runtime ──────────────────────

  it("registerSkill() adds skills at runtime", () => {
    const harness = ONIHarness.create({ model });

    harness.registerSkill({
      name: "code-review",
      description: "Reviews code for quality",
      content: "Review code carefully.",
      sourcePath: "/virtual/code-review",
    });

    const loader = harness.getSkillLoader();
    expect(loader.get("code-review")).toBeDefined();
    expect(loader.get("code-review")!.name).toBe("code-review");
  });

  // ── additional: run() accepts string for agentConfig ────────────────

  it("run() accepts string for agentConfig", async () => {
    const harness = ONIHarness.create({ model });
    const msgs = await collectMessages(harness.run("Hello", "my-agent"));

    const initMsg = msgs.find((m) => m.type === "system" && m.subtype === "init");
    expect(initMsg).toBeDefined();
    expect(initMsg!.content).toContain("my-agent");
  });

  // ── additional: soul + agent soul compose into systemPrompt ─────────

  it("composes soul and agent soul into systemPrompt", async () => {
    const harness = ONIHarness.create({
      model,
      soul: "You are helpful.",
    });

    await harness.runToResult("Hi", { name: "agent", soul: "You are an expert." });

    const chatCall = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ChatParams;
    expect(chatCall.systemPrompt).toContain("You are helpful.");
    expect(chatCall.systemPrompt).toContain("You are an expert.");
  });

  // ── additional: sharedTools and agent tools are both included ───────

  it("includes sharedTools and agent-specific tools", async () => {
    const sharedTool: ToolDefinition = {
      name: "SharedTool",
      description: "A shared tool",
      schema: { type: "object", properties: {} },
      execute: () => "shared",
    };

    const agentTool: ToolDefinition = {
      name: "AgentTool",
      description: "An agent tool",
      schema: { type: "object", properties: {} },
      execute: () => "agent",
    };

    const harness = ONIHarness.create({ model, sharedTools: [sharedTool] });
    await harness.runToResult("Hi", { name: "agent", tools: [agentTool] });

    const chatCall = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ChatParams;
    const toolNames = chatCall.tools?.map((t) => t.name) ?? [];

    expect(toolNames).toContain("SharedTool");
    expect(toolNames).toContain("AgentTool");
    expect(toolNames).toContain("TodoWrite");
    expect(toolNames).toContain("TodoRead");
    expect(toolNames).toContain("Skill");
  });
});
