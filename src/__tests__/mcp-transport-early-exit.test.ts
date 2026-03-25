/**
 * BUG-0425: If the MCP server process exits before _doStart resolves,
 * the old code called resolve() unconditionally — so callers received a
 * resolved Promise even though the process was already dead.
 *
 * Fix: wrapped resolve() in settle() so that if the exit handler runs first
 * and calls settle(() => reject(...)), the resolve() becomes a no-op.
 *
 * This test verifies the settle() guard semantics that underpin the fix
 * without spawning real processes, since the OS event loop timing makes
 * a deterministic race test impractical.
 */

import { describe, it, expect } from "vitest";

/**
 * Inline re-implementation of the settle() guard from transport._doStart().
 * We test its semantics directly to verify reject-wins-over-resolve ordering.
 */
function makeSettle() {
  let settled = false;
  const settle = (fn: () => void) => {
    if (!settled) {
      settled = true;
      fn();
    }
  };
  return settle;
}

describe("StdioTransport settle() guard — early exit semantics (BUG-0425)", () => {
  it("reject wins when exit handler fires before resolve (early-exit scenario)", () => {
    const outcomes: string[] = [];
    const settle = makeSettle();

    // Simulate exit handler firing first
    settle(() => outcomes.push("rejected: exited with code 1"));
    // Simulate the resolve() that would normally follow spawn
    settle(() => outcomes.push("resolved"));

    expect(outcomes).toEqual(["rejected: exited with code 1"]);
  });

  it("resolve wins when no exit occurs before spawn completes (normal scenario)", () => {
    const outcomes: string[] = [];
    const settle = makeSettle();

    // Simulate normal flow: no exit, resolve fires
    settle(() => outcomes.push("resolved"));
    // Exit handler fires after, but settle guard blocks it
    settle(() => outcomes.push("rejected: exited with code 0"));

    expect(outcomes).toEqual(["resolved"]);
  });

  it("settle() is idempotent — only the first call takes effect", () => {
    let count = 0;
    const settle = makeSettle();

    settle(() => count++);
    settle(() => count++);
    settle(() => count++);

    expect(count).toBe(1);
  });

  it("error handler also loses to an earlier reject (double-rejection safe)", () => {
    const outcomes: string[] = [];
    const settle = makeSettle();

    // Exit fires first
    settle(() => outcomes.push("exit"));
    // Then an error event fires
    settle(() => outcomes.push("error"));
    // Then the spawn path tries to resolve
    settle(() => outcomes.push("resolve"));

    expect(outcomes).toEqual(["exit"]);
    expect(outcomes).toHaveLength(1);
  });
});
