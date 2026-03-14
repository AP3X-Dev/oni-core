// ============================================================
// @oni.bot/core/swarm — SwarmSnapshotStore
// ============================================================
// Point-in-time capture of swarm state for debugging.
// Captures state, agent statuses, tracer timeline, and metadata.
// Supports listing, restoring, diffing, and clearing snapshots.
// ============================================================

import type { AgentRegistry, AgentManifestEntry } from "./registry.js";
import type { SwarmTracer, SwarmEvent } from "./tracer.js";

// ----------------------------------------------------------------
// Snapshot types
// ----------------------------------------------------------------

export interface SwarmSnapshot {
  /** Unique snapshot ID. */
  id:         string;
  /** Capture timestamp (ms since epoch). */
  timestamp:  number;
  /** Deep copy of swarm state at capture time. */
  state:      Record<string, unknown>;
  /** Agent statuses from registry (if provided at capture). */
  agents?:    AgentManifestEntry[];
  /** Tracer event timeline (if provided at capture). */
  timeline?:  SwarmEvent[];
  /** User-provided metadata. */
  metadata?:  Record<string, unknown>;
}

export interface SwarmSnapshotDiff {
  /** Keys present in snapshot B but not A. */
  added:     string[];
  /** Keys present in both but with different values. */
  changed:   string[];
  /** Keys present in A but not B. */
  removed:   string[];
  /** Keys present in both with identical values. */
  unchanged: string[];
}

export interface SnapshotCaptureOptions {
  registry?:  AgentRegistry;
  tracer?:    SwarmTracer;
  metadata?:  Record<string, unknown>;
}

// ----------------------------------------------------------------
// SwarmSnapshotStore
// ----------------------------------------------------------------

let _counter = 0;

export class SwarmSnapshotStore {
  private snapshots = new Map<string, SwarmSnapshot>();

  /**
   * Capture a point-in-time snapshot of the swarm state.
   * Returns the snapshot ID for later retrieval.
   */
  capture(
    state: Record<string, unknown>,
    opts?: SnapshotCaptureOptions,
  ): string {
    const id = `snap_${Date.now()}_${++_counter}`;
    // Fall back to JSON round-trip if state contains non-cloneable values
    // (functions, WeakRefs, etc.); JSON silently drops them rather than throwing.
    let clonedState: Record<string, unknown>;
    try {
      clonedState = structuredClone(state);
    } catch {
      clonedState = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    }
    const snapshot: SwarmSnapshot = {
      id,
      timestamp: Date.now(),
      state: clonedState,
    };

    if (opts?.registry) {
      snapshot.agents = opts.registry.manifest();
    }
    if (opts?.tracer) {
      snapshot.timeline = opts.tracer.getTimeline();
    }
    if (opts?.metadata) {
      snapshot.metadata = structuredClone(opts.metadata);
    }

    this.snapshots.set(id, snapshot);
    return id;
  }

  /** Retrieve a snapshot by ID. Returns null if not found. */
  restore(id: string): SwarmSnapshot | null {
    return this.snapshots.get(id) ?? null;
  }

  /** List all snapshots ordered by timestamp ascending. */
  list(): SwarmSnapshot[] {
    return [...this.snapshots.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Compare state between two snapshots.
   * Returns null if either snapshot ID is not found.
   */
  diff(idA: string, idB: string): SwarmSnapshotDiff | null {
    const a = this.snapshots.get(idA);
    const b = this.snapshots.get(idB);
    if (!a || !b) return null;

    const keysA = new Set(Object.keys(a.state));
    const keysB = new Set(Object.keys(b.state));

    const added: string[] = [];
    const changed: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];

    for (const k of keysB) {
      if (!keysA.has(k)) {
        added.push(k);
      } else if (!deepEqual(a.state[k], b.state[k])) {
        changed.push(k);
      } else {
        unchanged.push(k);
      }
    }

    for (const k of keysA) {
      if (!keysB.has(k)) {
        removed.push(k);
      }
    }

    return { added, changed, removed, unchanged };
  }

  /** Remove all stored snapshots. */
  clear(): void {
    this.snapshots.clear();
  }
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function deepEqual(a: unknown, b: unknown, seen = new WeakSet<object>()): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  // Cycle guard: if we've already started comparing this object, assume equal
  // (the non-cyclic portions have already matched at earlier recursion levels)
  if (seen.has(a as object)) return true;
  seen.add(a as object);

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i], seen));
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => deepEqual(objA[k], objB[k], seen));
}
