import { describe, it, expect } from "vitest";
import { SwarmGraph, quickAgent } from "../../swarm/graph.js";
import { toSwarmMermaid } from "../../swarm/mermaid.js";
import type { AgentRegistry } from "../../swarm/registry.js";
import type { SwarmExtensions, BaseSwarmState } from "../../swarm/graph.js";

// ── helpers ──────────────────────────────────────────────────

function mockModel(): any {
  return { generate: async () => ({ content: "pick: a" }) };
}

// ── tests ────────────────────────────────────────────────────

describe("toSwarmMermaid", () => {
  it("renders agent nodes with role labels", () => {
    const a = quickAgent("researcher", async () => ({ messages: [] }), {
      role: "Research Agent",
      capabilities: [{ name: "search", description: "Web search" }],
    });
    const b = quickAgent("writer", async () => ({ messages: [] }), {
      role: "Content Writer",
      capabilities: [{ name: "write", description: "Write articles" }],
    });

    const swarm = SwarmGraph.pipeline({ stages: [a, b] });
    const compiled = swarm.compile() as any;
    const mermaid = toSwarmMermaid(compiled.registry);

    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain("researcher");
    expect(mermaid).toContain("Research Agent");
    expect(mermaid).toContain("writer");
    expect(mermaid).toContain("Content Writer");
  });

  it("shows agent capabilities in node labels", () => {
    const a = quickAgent("analyst", async () => ({ messages: [] }), {
      role: "Data Analyst",
      capabilities: [
        { name: "analyze", description: "Analyze data" },
        { name: "visualize", description: "Create charts" },
      ],
    });

    const swarm = SwarmGraph.pipeline({ stages: [a] });
    const compiled = swarm.compile() as any;
    const mermaid = toSwarmMermaid(compiled.registry);

    expect(mermaid).toContain("analyze");
    expect(mermaid).toContain("visualize");
  });

  it("styles nodes by agent status", () => {
    const a = quickAgent("worker", async () => ({ messages: [] }), {
      role: "Worker",
    });
    const b = quickAgent("broken", async () => ({ messages: [] }), {
      role: "Broken",
    });

    const swarm = SwarmGraph.pipeline({ stages: [a, b] });
    const compiled = swarm.compile() as any;
    const registry: AgentRegistry = compiled.registry;

    // Set different statuses
    registry.markBusy("worker");
    registry.markError("broken");

    const mermaid = toSwarmMermaid(registry);

    // busy → blue, error → red
    expect(mermaid).toContain("style worker");
    expect(mermaid).toContain("style broken");
    // Verify different colors for different statuses
    const workerStyle = mermaid.split("\n").find((l: string) => l.includes("style worker"));
    const brokenStyle = mermaid.split("\n").find((l: string) => l.includes("style broken"));
    expect(workerStyle).not.toBe(brokenStyle);
  });

  it("includes idle agents with default styling", () => {
    const a = quickAgent("idle-agent", async () => ({ messages: [] }), {
      role: "Idle Worker",
    });

    const swarm = SwarmGraph.pipeline({ stages: [a] });
    const compiled = swarm.compile() as any;
    const mermaid = toSwarmMermaid(compiled.registry);

    expect(mermaid).toContain("idle-agent");
    expect(mermaid).toContain("Idle Worker");
  });

  it("excludes terminated agents", () => {
    const a = quickAgent("alive", async () => ({ messages: [] }), { role: "Active" });
    const b = quickAgent("dead", async () => ({ messages: [] }), { role: "Dead" });

    const swarm = SwarmGraph.pipeline({ stages: [a, b] });
    const compiled = swarm.compile() as any;
    const registry: AgentRegistry = compiled.registry;
    registry.setStatus("dead", "terminated");

    const mermaid = toSwarmMermaid(registry);

    expect(mermaid).toContain("alive");
    expect(mermaid).not.toContain("dead");
  });

  it("shows stats (activeTasks, errors) when present", () => {
    const a = quickAgent("busy-agent", async () => ({ messages: [] }), {
      role: "Worker Bee",
    });

    const swarm = SwarmGraph.pipeline({ stages: [a] });
    const compiled = swarm.compile() as any;
    const registry: AgentRegistry = compiled.registry;
    registry.markBusy("busy-agent");
    registry.markBusy("busy-agent");
    registry.markError("busy-agent");

    const mermaid = toSwarmMermaid(registry);

    // Should show active tasks and error count
    expect(mermaid).toContain("1 active");
    expect(mermaid).toContain("1 err");
  });
});
