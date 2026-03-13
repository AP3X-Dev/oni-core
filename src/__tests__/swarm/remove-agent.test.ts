import { describe, it, expect } from "vitest";
import {
  SwarmGraph, quickAgent, type BaseSwarmState,
} from "../../swarm/index.js";

describe("Agent deregistration", () => {
  it("removed agent is no longer routed to by supervisor", async () => {
    const invoked: string[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 3,
      },
      agents: [
        quickAgent("alpha", async () => {
          invoked.push("alpha");
          return { messages: [{ role: "assistant", content: "alpha" }] };
        }),
        quickAgent("beta", async () => {
          invoked.push("beta");
          return { messages: [{ role: "assistant", content: "beta" }], done: true };
        }),
      ],
    });

    const app = swarm.compile();

    // Remove alpha — supervisor should only route to beta
    app.removeAgent("alpha");

    const result = await app.invoke({ task: "test removal" });

    expect(result.done).toBe(true);
    expect(invoked).toContain("beta");
    expect(invoked).not.toContain("alpha");
  });

  it("registry stats reflect removal", async () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: { strategy: "round-robin", maxRounds: 1 },
      agents: [
        quickAgent("a", async () => ({ messages: [{ role: "assistant", content: "a" }], done: true })),
        quickAgent("b", async () => ({ messages: [{ role: "assistant", content: "b" }], done: true })),
      ],
    });

    const app = swarm.compile();

    expect(app.registry.getAll().length).toBe(2);

    app.removeAgent("a");

    expect(app.registry.getAll().length).toBe(1);
    expect(app.registry.getDef("a")).toBeNull();
    expect(app.registry.getDef("b")).not.toBeNull();
  });

  it("removing a non-existent agent is a no-op", async () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: { strategy: "round-robin", maxRounds: 1 },
      agents: [
        quickAgent("worker", async () => ({
          messages: [{ role: "assistant", content: "ok" }],
          done: true,
        })),
      ],
    });

    const app = swarm.compile();

    // Should not throw
    expect(() => app.removeAgent("nonexistent")).not.toThrow();
    expect(app.registry.getAll().length).toBe(1);
  });
});
