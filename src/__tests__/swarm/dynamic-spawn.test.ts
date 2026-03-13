import { describe, it, expect, vi } from "vitest";
import {
  SwarmGraph, quickAgent, type BaseSwarmState,
} from "../../swarm/index.js";
import type { ONIModel } from "../../models/types.js";

describe("Dynamic agent spawning", () => {
  it("spawnAgent adds agent to running swarm and supervisor routes to it", async () => {
    // Start with one pre-compiled agent
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        rules: [
          // Route to dynamic agent "helper" if it exists in the task
          { condition: (task) => task.includes("helper"), agentId: "helper" },
          { condition: () => true, agentId: "worker" },
        ],
        maxRounds: 3,
      },
      agents: [
        quickAgent("worker", async (state) => ({
          messages: [{ role: "assistant", content: `Worker handled: ${state.task}` }],
          done: true,
        })),
      ],
    });

    const app = swarm.compile();

    // Spawn a dynamic agent AFTER compilation
    app.spawnAgent(
      quickAgent("helper", async (state) => ({
        messages: [{ role: "assistant", content: `Helper handled: ${state.task}` }],
        done: true,
      })),
    );

    // The supervisor should route to the dynamically spawned "helper"
    const result = await app.invoke({ task: "needs helper" });

    expect(result.done).toBe(true);
    expect(result.messages.some(
      (m: { content: string }) => m.content.includes("Helper handled"),
    )).toBe(true);
  });

  it("dynamic agents appear in registry stats", async () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
      },
      agents: [
        quickAgent("static-agent", async () => ({
          messages: [{ role: "assistant", content: "static" }],
          done: true,
        })),
      ],
    });

    const app = swarm.compile();

    // Before spawning: 1 agent
    expect(app.registry.getAll().length).toBe(1);

    // Spawn dynamic agent
    app.spawnAgent(
      quickAgent("dynamic-agent", async () => ({
        messages: [{ role: "assistant", content: "dynamic" }],
        done: true,
      })),
    );

    // After spawning: 2 agents
    expect(app.registry.getAll().length).toBe(2);
    expect(app.registry.getDef("dynamic-agent")).toBeDefined();
  });

  it("dynamic agent errors fall back to supervisor like pre-compiled agents", async () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        rules: [
          { condition: (_, ctx) => (ctx as Record<string, unknown>).supervisorRound === 0, agentId: "failing-dynamic" },
          { condition: () => true, agentId: "fallback" },
        ],
        maxRounds: 3,
      },
      agents: [
        quickAgent("fallback", async () => ({
          messages: [{ role: "assistant", content: "fallback handled it" }],
          done: true,
        })),
      ],
    });

    const app = swarm.compile();

    // Spawn a dynamic agent that always fails
    app.spawnAgent(
      quickAgent("failing-dynamic", async () => {
        throw new Error("dynamic agent crashed");
      }, { maxRetries: 0 }),
    );

    const result = await app.invoke({ task: "test fallback" });

    // Should have fallen back to the supervisor, then to "fallback"
    expect(result.done).toBe(true);
    expect(result.messages.some(
      (m: { content: string }) => m.content.includes("fallback handled"),
    )).toBe(true);
  });
});
