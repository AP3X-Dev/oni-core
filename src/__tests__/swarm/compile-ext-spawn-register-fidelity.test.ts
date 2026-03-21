// Regression test for BUG-0320
// compile-ext.ts spawnAgent() previously used a double-cast
// (def as SwarmAgentDef<Record<string, unknown>> as any) when calling
// registry.register(). The fix aligned the generics so register receives the
// exact def without type-unsafe widening. This test confirms the full def is
// preserved in the registry after spawnAgent().

import { describe, it, expect } from "vitest";
import {
  SwarmGraph,
  quickAgent,
  type BaseSwarmState,
} from "../../swarm/index.js";

describe("BUG-0320 regression: spawnAgent preserves def fidelity in registry", () => {
  it("getDef returns the exact spawned def with all properties intact", () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
      },
      agents: [
        quickAgent("static-a", async () => ({
          messages: [{ role: "assistant", content: "static" }],
          done: true,
        })),
      ],
    });

    const app = swarm.compile();

    const spawned = quickAgent(
      "dynamic-b",
      async () => ({
        messages: [{ role: "assistant", content: "dynamic" }],
        done: true,
      }),
      {
        role: "SpecialistRole",
        capabilities: [
          { name: "analyze", description: "Performs analysis" },
          { name: "report", description: "Generates reports" },
        ],
        maxRetries: 2,
        maxConcurrency: 3,
      },
    );

    app.spawnAgent(spawned);

    const retrieved = app.registry.getDef("dynamic-b");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("dynamic-b");
    expect(retrieved!.role).toBe("SpecialistRole");
    expect(retrieved!.capabilities).toHaveLength(2);
    expect(retrieved!.capabilities![0]!.name).toBe("analyze");
    expect(retrieved!.capabilities![1]!.name).toBe("report");
    expect(retrieved!.maxRetries).toBe(2);
    expect(retrieved!.maxConcurrency).toBe(3);
  });

  it("spawnAgent registers the second agent independently of the first", () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
      },
      agents: [
        quickAgent("alpha", async () => ({
          messages: [{ role: "assistant", content: "alpha" }],
          done: true,
        })),
      ],
    });

    const app = swarm.compile();
    expect(app.registry.getAll().length).toBe(1);

    app.spawnAgent(
      quickAgent("beta", async () => ({
        messages: [{ role: "assistant", content: "beta" }],
        done: true,
      }), { role: "BetaRole", maxRetries: 1 }),
    );

    // Both agents present; original not clobbered; new agent retrievable
    expect(app.registry.getAll().length).toBe(2);
    expect(app.registry.getDef("alpha")).not.toBeNull();
    const beta = app.registry.getDef("beta");
    expect(beta).not.toBeNull();
    expect(beta!.role).toBe("BetaRole");
    expect(beta!.maxRetries).toBe(1);
  });
});
