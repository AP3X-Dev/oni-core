import { describe, it, expect } from "vitest";
import { END } from "../../types.js";
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

  it("conditional handoff to removed agent resolves to END instead of throwing NodeNotFoundError", async () => {
    const invoked: string[] = [];

    // Peer network: "router" always hands off to "worker" via conditional edge.
    // After removeAgent("worker"), that conditional edge must NOT throw — it should
    // resolve to END so the graph terminates gracefully.
    const swarm = SwarmGraph.peerNetwork<BaseSwarmState>({
      agents: [
        quickAgent("router", async (state) => {
          invoked.push("router");
          // Signal that we want to route to "worker" via context
          return { context: { ...state.context, next: "worker" }, messages: [{ role: "assistant", content: "routing" }] };
        }),
        quickAgent("worker", async () => {
          invoked.push("worker");
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }),
      ],
      entrypoint: "router",
      handoffs: {
        // condition returns the agent ID stored in context.next
        "router": (state) => (state.context?.next as string) === "worker" ? "worker" : END,
      },
    });

    const app = swarm.compile();

    // Remove "worker" — router's conditional handoff still resolves to "worker" at runtime
    app.removeAgent("worker");

    // Without fix: throws NodeNotFoundError("worker")
    // With fix: gracefully reaches END
    await expect(app.invoke({ task: "test" })).resolves.toBeDefined();
    expect(invoked).toContain("router");
    expect(invoked).not.toContain("worker");
  });

  it("pathMap entry pointing to removed agent remaps to END", async () => {
    const invoked: string[] = [];

    const swarm = SwarmGraph.peerNetwork<BaseSwarmState>({
      agents: [
        quickAgent("router", async (state) => {
          invoked.push("router");
          return { context: { ...state.context, route: "go-worker" }, messages: [{ role: "assistant", content: "routing" }] };
        }),
        quickAgent("worker", async () => {
          invoked.push("worker");
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }),
      ],
      entrypoint: "router",
      handoffs: {},
    });

    // Add a conditional edge with explicit pathMap that routes to "worker"
    swarm.inner.addConditionalEdges(
      "router",
      (state: BaseSwarmState) => (state.context?.route as string) ?? END,
      { "go-worker": "worker" },
    );

    const app = swarm.compile();

    app.removeAgent("worker");

    // Without fix: pathMap still maps "go-worker" → "worker", throws NodeNotFoundError
    // With fix: pathMap entry remapped to END, graph terminates gracefully
    await expect(app.invoke({ task: "test" })).resolves.toBeDefined();
    expect(invoked).toContain("router");
    expect(invoked).not.toContain("worker");
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

  it("repeated removeAgent of nonexistent IDs does not accumulate condition wrappers", () => {
    // If removeAgent wraps conditional edges unconditionally, calling it N times for
    // nonexistent agents creates N wrapper layers even though no edge ever referenced that agent.
    // The condition function reference must remain stable across removes of unknown agents.
    const swarm = SwarmGraph.peerNetwork<BaseSwarmState>({
      agents: [
        quickAgent("router", async (state) => ({
          context: { ...state.context, next: "worker" },
          messages: [{ role: "assistant", content: "routing" }],
        })),
        quickAgent("worker", async () => ({
          messages: [{ role: "assistant", content: "done" }],
          done: true,
        })),
      ],
      entrypoint: "router",
      handoffs: {
        "router": (state) => (state.context?.next as string) === "worker" ? "worker" : END,
      },
    });

    const app = swarm.compile();

    // Capture condition function reference BEFORE any removes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = (app as any)._runner;
    const getRouterCondition = () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (runner._edgesBySource.get("router") as any[])?.find((e: any) => e.type === "conditional")?.condition;

    const conditionBefore = getRouterCondition();
    expect(conditionBefore).toBeDefined();

    // Remove nonexistent agent multiple times
    app.removeAgent("ghost-1");
    app.removeAgent("ghost-2");
    app.removeAgent("ghost-3");

    // Condition function reference must be the same — no wrapper layers added
    const conditionAfter = getRouterCondition();
    expect(conditionAfter).toBe(conditionBefore);
  });
});
