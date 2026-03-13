import { describe, it, expect } from "vitest";
import { AgentRegistry } from "../../swarm/registry.js";
import { StateGraph } from "../../graph.js";
import { START, END } from "../../types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";
import type { AgentManifestEntry } from "../../swarm/registry.js";

// ── helpers ──────────────────────────────────────────────────

type S = Record<string, unknown>;

function makeDef(id: string, role: string, caps: Array<{ name: string; description: string }> = []): SwarmAgentDef<S> {
  const g = new StateGraph<S>({ channels: {} as any });
  g.addNode("work", () => ({}));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role, capabilities: caps, skeleton: g.compile(), maxRetries: 0 };
}

// ── tests ────────────────────────────────────────────────────

describe("AgentRegistry manifest()", () => {
  it("returns structured manifest entries for all non-terminated agents", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("a", "Researcher", [
      { name: "search", description: "Web search" },
      { name: "summarize", description: "Summarize docs" },
    ]));
    reg.register(makeDef("b", "Writer", [
      { name: "write", description: "Write content" },
    ]));

    const manifest = reg.manifest();

    expect(manifest).toHaveLength(2);

    const entryA = manifest.find((e) => e.id === "a")!;
    expect(entryA.role).toBe("Researcher");
    expect(entryA.capabilities).toEqual([
      { name: "search", description: "Web search" },
      { name: "summarize", description: "Summarize docs" },
    ]);
    expect(entryA.status).toBe("idle");
    expect(entryA.activeTasks).toBe(0);
    expect(entryA.totalRuns).toBe(0);
    expect(entryA.errors).toBe(0);

    const entryB = manifest.find((e) => e.id === "b")!;
    expect(entryB.role).toBe("Writer");
    expect(entryB.capabilities).toHaveLength(1);
  });

  it("excludes terminated agents from manifest", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("alive", "Active"));
    reg.register(makeDef("dead", "Terminated"));
    reg.setStatus("dead", "terminated");

    const manifest = reg.manifest();
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.id).toBe("alive");
  });

  it("reflects live status and stats changes", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("x", "Worker"));

    // Initially idle
    let manifest = reg.manifest();
    expect(manifest[0]!.status).toBe("idle");
    expect(manifest[0]!.totalRuns).toBe(0);

    // Mark busy
    reg.markBusy("x");
    manifest = reg.manifest();
    expect(manifest[0]!.status).toBe("busy");
    expect(manifest[0]!.activeTasks).toBe(1);
    expect(manifest[0]!.totalRuns).toBe(1);

    // Mark error
    reg.markError("x");
    manifest = reg.manifest();
    expect(manifest[0]!.status).toBe("error");
    expect(manifest[0]!.errors).toBe(1);
  });

  it("returns empty array for empty registry", () => {
    const reg = new AgentRegistry();
    expect(reg.manifest()).toEqual([]);
  });
});

// ── leastBusy / findIdle routing hot-path tests ─────────────

describe("AgentRegistry leastBusy()", () => {
  it("returns the agent with fewest active tasks", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("a", "Worker"));
    reg.register(makeDef("b", "Worker"));
    reg.register(makeDef("c", "Worker"));

    // a: 3 tasks, b: 1 task, c: 2 tasks
    reg.markBusy("a"); reg.markBusy("a"); reg.markBusy("a");
    reg.markBusy("b");
    reg.markBusy("c"); reg.markBusy("c");

    const least = reg.leastBusy();
    expect(least).not.toBeNull();
    expect(least!.def.id).toBe("b");
  });

  it("excludes terminated and error agents from consideration", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("terminated-agent", "Worker"));
    reg.register(makeDef("error-agent", "Worker"));
    reg.register(makeDef("healthy", "Worker"));

    reg.setStatus("terminated-agent", "terminated");
    reg.setStatus("error-agent", "error");
    reg.markBusy("healthy"); reg.markBusy("healthy");

    const least = reg.leastBusy();
    expect(least).not.toBeNull();
    expect(least!.def.id).toBe("healthy");
  });

  it("returns null when no agents are available", () => {
    const reg = new AgentRegistry();
    expect(reg.leastBusy()).toBeNull();
  });

  it("returns null when all agents are terminated or errored", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("x", "Worker"));
    reg.register(makeDef("y", "Worker"));
    reg.setStatus("x", "terminated");
    reg.setStatus("y", "error");
    expect(reg.leastBusy()).toBeNull();
  });

  it("prefers idle agents over busy ones", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("busy", "Worker"));
    reg.register(makeDef("idle", "Worker"));
    reg.markBusy("busy");

    const least = reg.leastBusy();
    expect(least!.def.id).toBe("idle");
    expect(least!.activeTasks).toBe(0);
  });
});

describe("AgentRegistry findIdle()", () => {
  it("returns agents that can accept work", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("idle-agent", "Worker"));
    reg.register(makeDef("busy-agent", "Worker"));

    reg.markBusy("busy-agent");

    const idle = reg.findIdle();
    expect(idle).toHaveLength(1);
    expect(idle[0]!.def.id).toBe("idle-agent");
  });

  it("excludes terminated and error agents", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("ok", "Worker"));
    reg.register(makeDef("dead", "Worker"));
    reg.register(makeDef("broken", "Worker"));
    reg.setStatus("dead", "terminated");
    reg.setStatus("broken", "error");

    const idle = reg.findIdle();
    expect(idle).toHaveLength(1);
    expect(idle[0]!.def.id).toBe("ok");
  });

  it("includes busy agents below maxConcurrency", () => {
    const reg = new AgentRegistry();
    const def = makeDef("concurrent", "Worker");
    def.maxConcurrency = 3;
    reg.register(def);
    reg.markBusy("concurrent"); // activeTasks = 1, maxConcurrency = 3

    const idle = reg.findIdle();
    expect(idle).toHaveLength(1);
    expect(idle[0]!.def.id).toBe("concurrent");
  });

  it("returns empty array when all agents are exhausted", () => {
    const reg = new AgentRegistry();
    reg.register(makeDef("a", "Worker"));
    reg.register(makeDef("b", "Worker"));
    reg.setStatus("a", "terminated");
    reg.setStatus("b", "error");

    expect(reg.findIdle()).toEqual([]);
  });
});
