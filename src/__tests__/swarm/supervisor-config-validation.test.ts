import { describe, it, expect, vi } from "vitest";
import { createSupervisorNode } from "../../swarm/supervisor.js";
import { AgentRegistry } from "../../swarm/registry.js";
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

function makeRegistry() {
  const registry = new AgentRegistry();
  registry.register({
    id: "agent-a",
    role: "Agent A",
    capabilities: [{ name: "work", description: "Does work" }],
    skeleton: makeSkeleton(),
  });
  return registry;
}

describe("Supervisor config validation", () => {
  it("throws a descriptive error when strategy is 'llm' but no model is provided", () => {
    const registry = makeRegistry();

    expect(() =>
      createSupervisorNode(registry, {
        strategy: "llm",
        taskField: "task",
      }),
    ).toThrowError(/strategy.*"llm".*requires.*model/i);
  });

  it("accepts strategy 'llm' when a model IS provided", () => {
    const registry = makeRegistry();
    const model = mockModel("agent-a");

    expect(() =>
      createSupervisorNode(registry, {
        strategy: "llm",
        taskField: "task",
        model,
      }),
    ).not.toThrow();
  });

  it("does not require model for 'round-robin' strategy", () => {
    const registry = makeRegistry();

    expect(() =>
      createSupervisorNode(registry, {
        strategy: "round-robin",
        taskField: "task",
      }),
    ).not.toThrow();
  });

  it("does not require model for 'rule' strategy", () => {
    const registry = makeRegistry();

    expect(() =>
      createSupervisorNode(registry, {
        strategy: "rule",
        taskField: "task",
        rules: [{ condition: () => true, agentId: "agent-a" }],
      }),
    ).not.toThrow();
  });

  it("does not require model for 'capability' strategy", () => {
    const registry = makeRegistry();

    expect(() =>
      createSupervisorNode(registry, {
        strategy: "capability",
        taskField: "task",
      }),
    ).not.toThrow();
  });

  it("throws an ONIError with correct code and category", () => {
    const registry = makeRegistry();

    try {
      createSupervisorNode(registry, {
        strategy: "llm",
        taskField: "task",
      });
      // Should not reach here
      expect.unreachable("Expected createSupervisorNode to throw");
    } catch (err: any) {
      expect(err.code).toBe("ONI_SWARM_CONFIG");
      expect(err.category).toBe("SWARM");
      expect(err.recoverable).toBe(false);
    }
  });
});
