import { describe, it, expect } from "vitest";
import { HITLSessionStore } from "../hitl/resume.js";

/**
 * Regression test for BUG-0433: The HITL resume() method validated a session
 * then awaited runner.invoke() before calling markResumed(). Two concurrent
 * resume() calls for the same resumeId could both pass the existence+threadId
 * guard, causing duplicate invocations.
 *
 * The validator noted that the original fix (moving markResumed before invoke)
 * was insufficient because the guard never checked session.status. A concurrent
 * call that arrives after the first passes the existence check but before
 * markResumed() fires would still proceed.
 *
 * Fix (landed in main): check `session.status !== "pending"` immediately after
 * the threadId guard and before markResumed(). The status check + markResumed()
 * are synchronous, closing the TOCTOU window.
 *
 * These tests verify HITLSessionStore.get() exposes status correctly so the
 * guard in graph.ts can make the correct decision.
 */

describe("BUG-0433: HITL resume TOCTOU — status guard prevents duplicate invocations", () => {
  function makeStore() {
    // Use a very long TTL so sessions never expire during tests.
    return new HITLSessionStore(60_000);
  }

  function makeInterrupt(resumeId: string, node = "approval-node") {
    return { resumeId, node, value: { __type: "user_input_request", prompt: "Approve?" } };
  }

  function makeCheckpoint() {
    return { state: {}, threadId: "t1", checkpoint: {} } as never;
  }

  it("BUG-0433: get() returns session with status=pending before markResumed", () => {
    const store = makeStore();
    store.record("t1", makeInterrupt("r1"), makeCheckpoint());

    const session = store.get("r1");
    expect(session).not.toBeNull();
    expect(session!.status).toBe("pending");
  });

  it("BUG-0433: get() returns session with status=resumed after markResumed", () => {
    const store = makeStore();
    store.record("t1", makeInterrupt("r2"), makeCheckpoint());

    store.markResumed("r2");
    const session = store.get("r2");

    // Session must still be retrievable (not deleted) right after markResumed.
    expect(session).not.toBeNull();
    expect(session!.status).toBe("resumed");
  });

  it("BUG-0433: second concurrent resume() call is rejected by status guard", async () => {
    // Simulate the graph.ts resume() guard logic directly against the store.
    // This is the exact synchronous check that closes the TOCTOU window.
    const store = makeStore();
    store.record("t1", makeInterrupt("r3"), makeCheckpoint());

    // --- First resume call (synchronous portion) ---
    const session1 = store.get("r3");
    expect(session1).not.toBeNull();
    expect(session1!.threadId).toBe("t1");
    // Status guard: first call sees "pending" and proceeds.
    expect(session1!.status).toBe("pending");
    // Mark as resumed synchronously before any await.
    store.markResumed("r3");

    // --- Second concurrent resume call (arrives while first awaits invoke) ---
    const session2 = store.get("r3");
    // The session still exists (markResumed keeps it in the map).
    expect(session2).not.toBeNull();
    // Status guard: second call must see "resumed" and must NOT proceed.
    expect(session2!.status).toBe("resumed");
    // The guard in graph.ts throws when status !== "pending".
    // Verify the condition that causes the throw:
    const shouldReject = session2!.status !== "pending";
    expect(shouldReject).toBe(true);
  });

  it("BUG-0433: N concurrent resume calls only the first passes the status guard", () => {
    const store = makeStore();
    store.record("t1", makeInterrupt("r4"), makeCheckpoint());

    let passCount = 0;

    // Simulate N concurrent callers all reaching the status check at the
    // same logical moment (before any has called markResumed).
    // With the fix, only the first call atomically grabs "pending" and marks it.
    for (let i = 0; i < 5; i++) {
      const session = store.get("r4");
      if (session && session.status === "pending") {
        // This is the atomic check-and-mark in graph.ts.
        store.markResumed("r4");
        passCount++;
      }
      // Subsequent iterations: status is now "resumed", so the if() fails.
    }

    expect(passCount).toBe(1);
  });

  it("BUG-0433: expired session is not retrievable and cannot be double-resumed", () => {
    // Record at a createdAt far in the past by manipulating Date.now temporarily.
    const store = makeStore();
    const realNow = Date.now;
    // Simulate the session was recorded 10 minutes ago (past the 1-minute TTL).
    Date.now = () => realNow() - 10 * 60 * 1000;
    store.record("t1", makeInterrupt("r5"), makeCheckpoint());
    Date.now = realNow;

    // Now get() with the real clock — evict() sees the session is past TTL.
    const session = store.get("r5");

    // The session must be expired and removed — graph.ts throws "not found".
    expect(session).toBeNull();
  });
});
