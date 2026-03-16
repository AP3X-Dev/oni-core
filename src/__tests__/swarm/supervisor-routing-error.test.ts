import { describe, it, expect, vi } from "vitest";
import { createSupervisorNode } from "../../swarm/supervisor.js";
import { AgentRegistry } from "../../swarm/registry.js";
import { ONIError } from "../../errors.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

describe("createSupervisorNode", () => {
  it("BUG-0002: should throw ONIError with ONI_SWARM_ROUTING when LLM routing fails", async () => {
    const registry = new AgentRegistry();
    registry.register({
      id: "agent-a",
      role: "worker",
      capabilities: [{ name: "test", description: "test" }],
      skeleton: { invoke: vi.fn(), stream: vi.fn() } as any,
    } as SwarmAgentDef);

    const failingModel = {
      chat: vi.fn().mockRejectedValue(new Error("auth failure")),
      stream: vi.fn(),
      modelId: "test-model",
    };

    const node = createSupervisorNode(registry, {
      strategy: "llm",
      model: failingModel as any,
    });

    const state = {
      task: "do something",
      context: {},
      supervisorRound: 0,
      currentAgent: null,
      agentResults: {},
      messages: [],
      done: false,
      swarmMessages: [],
      handoffHistory: [],
    };

    await expect(node(state as any)).rejects.toThrowError(ONIError);
    try {
      await node(state as any);
    } catch (err) {
      expect(err).toBeInstanceOf(ONIError);
      expect((err as ONIError).code).toBe("ONI_SWARM_ROUTING");
      expect((err as ONIError).category).toBe("SWARM");
      expect((err as ONIError).recoverable).toBe(true);
    }
  });
});
