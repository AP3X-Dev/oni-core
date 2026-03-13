import { describe, it, expect, vi } from "vitest";
import { createSupervisorNode } from "../../swarm/supervisor.js";
import { AgentRegistry } from "../../swarm/registry.js";
import { END } from "../../types.js";
import { Command } from "../../types.js";
import type { ONIModel } from "../../models/types.js";

function mockModel(responseContent: string): ONIModel {
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn().mockResolvedValue({
      content: responseContent,
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "end" as const,
    }),
    async *stream() {},
  };
}

function makeSkeleton() {
  return {
    invoke: vi.fn().mockResolvedValue({}),
    stream: vi.fn(),
  } as any;
}

describe("Supervisor with ONIModel", () => {
  it("routes via ONIModel.chat() instead of SwarmLLM.invoke()", async () => {
    const model = mockModel("researcher");
    const registry = new AgentRegistry();
    registry.register({
      id: "researcher",
      role: "Research Specialist",
      capabilities: [{ name: "research", description: "Finds info" }],
      skeleton: makeSkeleton(),
    });

    const supervisorFn = createSupervisorNode(registry, {
      model,
      strategy: "llm",
      taskField: "task",
      maxRounds: 5,
    });

    const state = {
      task: "Find info about AI",
      context: {},
      supervisorRound: 0,
      currentAgent: null,
      agentResults: {},
      messages: [],
      done: false,
    };

    const result = await supervisorFn(state);

    // Should have called model.chat, not some SwarmLLM.invoke
    expect(model.chat).toHaveBeenCalledOnce();
    const chatArgs = (model.chat as any).mock.calls[0][0];
    expect(chatArgs.messages).toBeDefined();
    expect(chatArgs.messages[0].role).toBe("user");

    // Should route to "researcher"
    expect(result).toBeInstanceOf(Command);
    expect((result as Command<any>).goto).toBe("researcher");
  });

  it("falls back to END when model returns unrecognized agent", async () => {
    const model = mockModel("nonexistent-agent");
    const registry = new AgentRegistry();
    registry.register({
      id: "writer",
      role: "Writer",
      capabilities: [{ name: "write", description: "Writes" }],
      skeleton: makeSkeleton(),
    });

    const supervisorFn = createSupervisorNode(registry, {
      model,
      strategy: "llm",
      taskField: "task",
    });

    const state = {
      task: "Write something",
      context: {},
      supervisorRound: 0,
      currentAgent: null,
      agentResults: {},
      messages: [],
      done: false,
    };

    const result = await supervisorFn(state);
    expect(result).toBeInstanceOf(Command);
    expect((result as Command<any>).goto).toBe(END);
  });

  it("rule-based and round-robin strategies still work", async () => {
    const registry = new AgentRegistry();
    registry.register({
      id: "a",
      role: "A",
      capabilities: [{ name: "do", description: "does" }],
      skeleton: makeSkeleton(),
    });
    registry.register({
      id: "b",
      role: "B",
      capabilities: [{ name: "do", description: "does" }],
      skeleton: makeSkeleton(),
    });

    // Rule-based
    const ruleFn = createSupervisorNode(registry, {
      strategy: "rule",
      taskField: "task",
      rules: [
        { condition: (task) => task.includes("alpha"), agentId: "a" },
        { condition: () => true, agentId: "b" },
      ],
    });

    const state = {
      task: "alpha task",
      context: {},
      supervisorRound: 0,
      currentAgent: null,
      agentResults: {},
      messages: [],
      done: false,
    };

    const ruleResult = await ruleFn(state);
    expect((ruleResult as Command<any>).goto).toBe("a");

    // Round-robin
    const rrFn = createSupervisorNode(registry, {
      strategy: "round-robin",
      taskField: "task",
    });

    const rr0 = await rrFn({ ...state, supervisorRound: 0 });
    const rr1 = await rrFn({ ...state, supervisorRound: 1 });
    expect((rr0 as Command<any>).goto).not.toBe((rr1 as Command<any>).goto);
  });
});
