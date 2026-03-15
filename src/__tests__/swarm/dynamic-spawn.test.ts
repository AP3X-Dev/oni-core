import { describe, it, expect } from "vitest";
import {
  SwarmGraph, quickAgent, Handoff, type BaseSwarmState,
} from "../../swarm/index.js";

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

  it("spawned agent that returns a Handoff routes to the handoff target", async () => {
    // Static agents handle Handoff via createAgentNode; spawnAgent must use the same path.
    // Without the fix the inline executor returns the Handoff object as raw state, so no
    // Command.goto is emitted and the handoff target is never reached.
    const invoked: string[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        rules: [
          { condition: () => true, agentId: "agent-a" },
        ],
        maxRounds: 3,
      },
      agents: [
        quickAgent("agent-b", async () => {
          invoked.push("agent-b");
          return { messages: [{ role: "assistant", content: "b done" }], done: true };
        }),
      ],
    });

    const app = swarm.compile();

    // Spawn agent-a dynamically — it will hand off to agent-b
    app.spawnAgent(
      quickAgent("agent-a", async () => {
        invoked.push("agent-a");
        return new Handoff({ to: "agent-b", message: "passing to b" }) as unknown as Partial<BaseSwarmState>;
      }),
    );

    const result = await app.invoke({ task: "test handoff" });

    expect(result.done).toBe(true);
    expect(invoked).toContain("agent-a");
    expect(invoked).toContain("agent-b");
  });

  it("spawned agent error context includes structured type and attempt fields", async () => {
    // createAgentNode produces { agent, error, type, attempt, maxRetries } in lastAgentError.
    // The inline spawnAgent executor only sets { agent, error } — missing type and attempt.
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        rules: [
          { condition: (_, ctx) => !(ctx as Record<string, unknown>).lastAgentError, agentId: "crashing-dynamic" },
          { condition: () => true, agentId: "inspector" },
        ],
        maxRounds: 4,
      },
      agents: [
        quickAgent("inspector", async (state) => ({
          messages: [{ role: "assistant", content: "inspected" }],
          context: { ...state.context, errorSeen: state.context?.lastAgentError },
          done: true,
        })),
      ],
    });

    const app = swarm.compile();

    app.spawnAgent(
      quickAgent("crashing-dynamic", async () => {
        throw new Error("deliberate crash");
      }, { maxRetries: 0 }),
    );

    const result = await app.invoke({ task: "error test" });

    // The error context written by the spawned agent must match createAgentNode format
    const err = result.context?.errorSeen as Record<string, unknown> | undefined;
    expect(err).toBeDefined();
    expect(err?.agent).toBe("crashing-dynamic");
    expect(err?.type).toBeDefined();     // "unknown" — missing from inline executor
    expect(err?.attempt).toBeDefined();  // 0 — missing from inline executor
    expect(err?.maxRetries).toBeDefined(); // 0 — missing from inline executor
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
