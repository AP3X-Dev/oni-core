import { describe, it, expect } from "vitest";
import { HITLSessionStore } from "../hitl/resume.js";

/**
 * Bug: HITL resume marks the session as "resumed" before runner.invoke().
 * If invoke() throws (transient network error, downstream failure), the
 * session is permanently stuck in "resumed" — getByThread() only returns
 * "pending" sessions, so the session is effectively burned until TTL expiry.
 *
 * Fix: markResumed() should be revertible — on invoke() failure, session
 * status should revert to "pending" so it can be retried.
 */

describe("HITL resume failure safety — session reverts to pending on invoke failure", () => {
  function makeStore() {
    return new HITLSessionStore(60_000);
  }

  function makeInterrupt(resumeId: string, node = "approval-node") {
    return { resumeId, node, value: { __type: "user_input_request", prompt: "Approve?" } };
  }

  function makeCheckpoint() {
    return { state: {}, threadId: "t1", checkpoint: {} } as never;
  }

  it("markPending() reverts a resumed session back to pending", () => {
    const store = makeStore();
    store.record("t1", makeInterrupt("r1"), makeCheckpoint());

    // Simulate the resume flow: mark as resumed
    store.markResumed("r1");
    expect(store.get("r1")!.status).toBe("resumed");

    // On failure, revert to pending
    store.markPending("r1");
    expect(store.get("r1")!.status).toBe("pending");
  });

  it("reverted session appears in getByThread() again", () => {
    const store = makeStore();
    store.record("t1", makeInterrupt("r2"), makeCheckpoint());

    // Before resume: visible in getByThread
    expect(store.getByThread("t1").length).toBe(1);

    // After resume: hidden from getByThread (only returns pending)
    store.markResumed("r2");
    expect(store.getByThread("t1").length).toBe(0);

    // After revert: visible again
    store.markPending("r2");
    expect(store.getByThread("t1").length).toBe(1);
  });

  it("reverted session can be resumed again", () => {
    const store = makeStore();
    store.record("t1", makeInterrupt("r3"), makeCheckpoint());

    // First attempt: mark resumed, then revert (simulating invoke failure)
    store.markResumed("r3");
    store.markPending("r3");

    // Second attempt: should be able to mark resumed again
    const session = store.get("r3");
    expect(session).not.toBeNull();
    expect(session!.status).toBe("pending");

    store.markResumed("r3");
    expect(store.get("r3")!.status).toBe("resumed");
  });
});
