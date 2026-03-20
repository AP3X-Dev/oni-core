// Regression test for BUG-0269
//
// deepEqual() previously used two independent WeakSets (seenA, seenB) checked with AND.
// This caused cross-pair contamination: an object seen in seenA from one comparison pair
// and an unrelated object seen in seenB from a different pair could both pass the guard,
// returning `true` for cyclic structures that are NOT actually equal.
//
// Fix: replaced with a Map<object, Set<object>> tracking (a, b) pairs together, so only
// the exact pair that was already visited is treated as "seen" — preventing false equality.

import { describe, it, expect } from "vitest";
import { SwarmSnapshotStore } from "../../swarm/snapshot.js";

describe("BUG-0269: deepEqual cycle detection uses paired tracking, not independent WeakSets", () => {
  it("BUG-0269: two cyclic objects with the same structure but different values are NOT equal", () => {
    const store = new SwarmSnapshotStore();

    // Build cyclic structure A: { value: 1, self: [circular] }
    const cycleA: Record<string, unknown> = { value: 1 };
    cycleA.self = cycleA;

    // Build cyclic structure B: { value: 2, self: [circular] }
    // Same shape, different `value` — these are NOT equal.
    const cycleB: Record<string, unknown> = { value: 2 };
    cycleB.self = cycleB;

    const idA = store.capture({ data: cycleA });
    const idB = store.capture({ data: cycleB });

    const result = store.diff(idA, idB);

    expect(result).not.toBeNull();
    // BUG: with independent WeakSets, cross-pair contamination could mark
    // cycleA and cycleB as "already seen" and return true (equal).
    // Fix: paired tracking correctly detects that value 1 !== value 2.
    expect(result!.changed).toContain("data");
    expect(result!.unchanged).not.toContain("data");
  });

  it("BUG-0269: two identical cyclic objects ARE equal", () => {
    const store = new SwarmSnapshotStore();

    // Build cyclic structure: { x: "hello", self: [circular] }
    const cycleA: Record<string, unknown> = { x: "hello" };
    cycleA.self = cycleA;

    // Same structure and values — these ARE equal.
    const cycleB: Record<string, unknown> = { x: "hello" };
    cycleB.self = cycleB;

    const idA = store.capture({ data: cycleA });
    const idB = store.capture({ data: cycleB });

    const result = store.diff(idA, idB);

    expect(result).not.toBeNull();
    expect(result!.unchanged).toContain("data");
    expect(result!.changed).not.toContain("data");
  });

  it("BUG-0269: mutually-referencing pair (a.ref = b, b.ref = a) with differing values is NOT equal to same shape with different values", () => {
    const store = new SwarmSnapshotStore();

    // Pair 1: a1.ref = b1, b1.ref = a1, a1.value = 10
    const a1: Record<string, unknown> = { value: 10 };
    const b1: Record<string, unknown> = { value: 20 };
    a1.partner = b1;
    b1.partner = a1;

    // Pair 2: a2.ref = b2, b2.ref = a2, a2.value = 99 — different values
    const a2: Record<string, unknown> = { value: 99 };
    const b2: Record<string, unknown> = { value: 20 };
    a2.partner = b2;
    b2.partner = a2;

    const id1 = store.capture({ data: a1 });
    const id2 = store.capture({ data: a2 });

    const result = store.diff(id1, id2);

    expect(result).not.toBeNull();
    // a1.value (10) !== a2.value (99), so "data" must be in `changed`
    expect(result!.changed).toContain("data");
    expect(result!.unchanged).not.toContain("data");
  });

  it("BUG-0269: non-cyclic diffing still works correctly after the fix", () => {
    const store = new SwarmSnapshotStore();

    const id1 = store.capture({ x: 1, y: "hello", z: [1, 2, 3] });
    const id2 = store.capture({ x: 1, y: "world", z: [1, 2, 3] });

    const result = store.diff(id1, id2);

    expect(result).not.toBeNull();
    expect(result!.unchanged).toContain("x");
    expect(result!.changed).toContain("y");
    expect(result!.unchanged).toContain("z");
  });
});
