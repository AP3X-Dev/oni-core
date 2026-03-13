import { describe, it, expect } from "vitest";
import { SwarmSnapshotStore } from "../../swarm/snapshot.js";
import { AgentRegistry } from "../../swarm/registry.js";
import { SwarmTracer } from "../../swarm/tracer.js";
import { StateGraph } from "../../graph.js";
import { START, END } from "../../types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

// ── helpers ──────────────────────────────────────────────────

type S = Record<string, unknown>;

function makeDef(id: string, role: string): SwarmAgentDef<S> {
  const g = new StateGraph<S>({ channels: {} as any });
  g.addNode("work", () => ({}));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role, capabilities: [], skeleton: g.compile(), maxRetries: 0 };
}

// ── tests ────────────────────────────────────────────────────

describe("SwarmSnapshotStore", () => {
  it("captures and restores a snapshot of state", () => {
    const store = new SwarmSnapshotStore();
    const state = { task: "hello", results: [1, 2, 3] };

    const id = store.capture(state);
    const snap = store.restore(id);

    expect(snap).not.toBeNull();
    expect(snap!.state).toEqual(state);
    expect(snap!.id).toBe(id);
    expect(typeof snap!.timestamp).toBe("number");
  });

  it("captures registry agent statuses", () => {
    const store = new SwarmSnapshotStore();
    const registry = new AgentRegistry();
    registry.register(makeDef("a", "Researcher"));
    registry.register(makeDef("b", "Writer"));
    registry.markBusy("a");

    const id = store.capture({ task: "test" }, { registry });
    const snap = store.restore(id);

    expect(snap!.agents).toHaveLength(2);
    const agentA = snap!.agents!.find((a) => a.id === "a");
    expect(agentA!.status).toBe("busy");
    expect(agentA!.activeTasks).toBe(1);

    const agentB = snap!.agents!.find((a) => a.id === "b");
    expect(agentB!.status).toBe("idle");
  });

  it("captures tracer timeline", () => {
    const store = new SwarmSnapshotStore();
    const tracer = new SwarmTracer();
    tracer.record({ type: "agent_start", agentId: "x", timestamp: 100 });
    tracer.record({ type: "agent_complete", agentId: "x", timestamp: 200 });

    const id = store.capture({ task: "test" }, { tracer });
    const snap = store.restore(id);

    expect(snap!.timeline).toHaveLength(2);
    expect(snap!.timeline![0]!.type).toBe("agent_start");
    expect(snap!.timeline![1]!.type).toBe("agent_complete");
  });

  it("stores optional metadata", () => {
    const store = new SwarmSnapshotStore();
    const id = store.capture({ x: 1 }, { metadata: { label: "before-crash", step: 5 } });
    const snap = store.restore(id);

    expect(snap!.metadata).toEqual({ label: "before-crash", step: 5 });
  });

  it("returns null for unknown snapshot id", () => {
    const store = new SwarmSnapshotStore();
    expect(store.restore("nonexistent")).toBeNull();
  });

  it("lists all snapshots ordered by timestamp", () => {
    const store = new SwarmSnapshotStore();
    store.capture({ step: 1 });
    store.capture({ step: 2 });
    store.capture({ step: 3 });

    const list = store.list();
    expect(list).toHaveLength(3);
    // Ordered by timestamp ascending
    expect(list[0]!.state).toEqual({ step: 1 });
    expect(list[2]!.state).toEqual({ step: 3 });
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.timestamp).toBeGreaterThanOrEqual(list[i - 1]!.timestamp);
    }
  });

  it("diffs two snapshots showing state changes", () => {
    const store = new SwarmSnapshotStore();
    const id1 = store.capture({ task: "hello", count: 0 });
    const id2 = store.capture({ task: "hello", count: 5, newField: true });

    const diff = store.diff(id1, id2);

    expect(diff).not.toBeNull();
    expect(diff!.added).toContain("newField");
    expect(diff!.changed).toContain("count");
    expect(diff!.removed).toHaveLength(0);
    expect(diff!.unchanged).toContain("task");
  });

  it("diff detects removed keys", () => {
    const store = new SwarmSnapshotStore();
    const id1 = store.capture({ a: 1, b: 2, c: 3 });
    const id2 = store.capture({ a: 1 });

    const diff = store.diff(id1, id2);

    expect(diff!.removed).toContain("b");
    expect(diff!.removed).toContain("c");
    expect(diff!.unchanged).toContain("a");
  });

  it("diff returns null for unknown snapshot ids", () => {
    const store = new SwarmSnapshotStore();
    const id = store.capture({ x: 1 });

    expect(store.diff(id, "unknown")).toBeNull();
    expect(store.diff("unknown", id)).toBeNull();
  });

  it("clear removes all snapshots", () => {
    const store = new SwarmSnapshotStore();
    store.capture({ a: 1 });
    store.capture({ b: 2 });

    expect(store.list()).toHaveLength(2);
    store.clear();
    expect(store.list()).toHaveLength(0);
  });

  it("diff handles circular references in state without stack overflow", () => {
    const store = new SwarmSnapshotStore();

    // Create state with circular reference
    const stateA: Record<string, unknown> = { task: "hello", count: 1 };
    stateA.self = stateA; // circular

    const stateB: Record<string, unknown> = { task: "hello", count: 2 };
    stateB.self = stateB; // circular

    const idA = store.capture(stateA);
    const idB = store.capture(stateB);

    // Should not throw (stack overflow) — should complete and produce a diff
    const diff = store.diff(idA, idB);
    expect(diff).not.toBeNull();
    // "task" is unchanged, "count" changed, "self" is circular in both
    expect(diff!.unchanged).toContain("task");
    expect(diff!.changed).toContain("count");
  });

  it("diff correctly identifies identical circular structures as unchanged", () => {
    const store = new SwarmSnapshotStore();

    const stateA: Record<string, unknown> = { value: 42 };
    stateA.ref = stateA;

    const stateB: Record<string, unknown> = { value: 42 };
    stateB.ref = stateB;

    const idA = store.capture(stateA);
    const idB = store.capture(stateB);

    const diff = store.diff(idA, idB);
    expect(diff).not.toBeNull();
    expect(diff!.changed).toHaveLength(0);
    expect(diff!.added).toHaveLength(0);
    expect(diff!.removed).toHaveLength(0);
  });
});
