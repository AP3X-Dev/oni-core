import { describe, it, expect } from "vitest";
import {
  StateGraph, START, END, lastValue,
  MemoryCheckpointer,
  NodeInterruptSignal,
  HITLInterruptException,
  HITLSessionStore,
} from "../index.js";
import {
  interrupt,
  getUserInput,
  getUserApproval,
  getUserSelection,
  _installInterruptContext,
  _clearInterruptContext,
  _getInterruptContext,
} from "../hitl/index.js";
import type { InterruptValue } from "../hitl/index.js";

// ----------------------------------------------------------------
// 1. interrupt() throws NodeInterruptSignal
// ----------------------------------------------------------------

describe("interrupt() throws NodeInterruptSignal", () => {
  it("throws NodeInterruptSignal with correct value and resumeId when no resume is available", async () => {
    await _installInterruptContext({
      nodeName: "test-node",
      resumeValues: [],
    }, async () => {
      try {
        await interrupt({ message: "Please approve" });
        expect.unreachable("interrupt() should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NodeInterruptSignal);
        const signal = err as NodeInterruptSignal;
        expect(signal.isNodeInterrupt).toBe(true);
        expect(signal.value).toEqual({ message: "Please approve" });
        expect(signal.resumeId).toMatch(/^test-node-/);
      }
    });
  });

  it("returns the resume value when hasResume is true", async () => {
    await _installInterruptContext({
      nodeName: "test-node",
      resumeValues: ["user-response-123"],
    }, async () => {
      const result = await interrupt("ignored value");
      expect(result).toBe("user-response-123");
    });
  });

  it("generates unique resumeIds across calls", async () => {
    const resumeIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      await _installInterruptContext({
        nodeName: "multi-node",
        resumeValues: [],
      }, async () => {
        try {
          await interrupt("test");
        } catch (err) {
          const signal = err as NodeInterruptSignal;
          resumeIds.push(signal.resumeId);
        }
      });
    }

    const unique = new Set(resumeIds);
    expect(unique.size).toBe(3);
  });
});

// ----------------------------------------------------------------
// 2. getUserInput() throws with correct metadata
// ----------------------------------------------------------------

describe("getUserInput() throws with correct metadata", () => {
  it("includes prompt and inputType in the interrupt value", async () => {
    await _installInterruptContext({
      nodeName: "input-node",
      resumeValues: [],
    }, async () => {
      try {
        await getUserInput({
          prompt: "What is your name?",
          inputType: "text",
        });
        expect.unreachable("getUserInput() should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NodeInterruptSignal);
        const signal = err as NodeInterruptSignal;
        const val = signal.value as Record<string, unknown>;
        expect(val.__type).toBe("user_input_request");
        expect(val.prompt).toBe("What is your name?");
        expect(val.inputType).toBe("text");
        expect(val.hasValidator).toBe(false);
      }
    });
  });

  it("defaults inputType to 'text' when not provided", async () => {
    await _installInterruptContext({
      nodeName: "input-node",
      resumeValues: [],
    }, async () => {
      try {
        await getUserInput({ prompt: "Enter something" });
        expect.unreachable("should have thrown");
      } catch (err) {
        const signal = err as NodeInterruptSignal;
        const val = signal.value as Record<string, unknown>;
        expect(val.inputType).toBe("text");
      }
    });
  });

  it("sets hasValidator to true when validate function is provided", async () => {
    await _installInterruptContext({
      nodeName: "input-node",
      resumeValues: [],
    }, async () => {
      try {
        await getUserInput({
          prompt: "Enter a number",
          inputType: "number",
          validate: (v) => typeof v === "number",
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        const signal = err as NodeInterruptSignal;
        const val = signal.value as Record<string, unknown>;
        expect(val.hasValidator).toBe(true);
        expect(val.inputType).toBe("number");
      }
    });
  });

  it("includes the field name when provided", async () => {
    await _installInterruptContext({
      nodeName: "input-node",
      resumeValues: [],
    }, async () => {
      try {
        await getUserInput({
          prompt: "Enter email",
          field: "email",
          inputType: "text",
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        const signal = err as NodeInterruptSignal;
        const val = signal.value as Record<string, unknown>;
        expect(val.field).toBe("email");
      }
    });
  });
});

// ----------------------------------------------------------------
// 3. getUserApproval() throws with correct metadata
// ----------------------------------------------------------------

describe("getUserApproval() throws with correct metadata", () => {
  it("creates a boolean approval request", async () => {
    await _installInterruptContext({
      nodeName: "approval-node",
      resumeValues: [],
    }, async () => {
      try {
        await getUserApproval("Deploy to production?");
        expect.unreachable("getUserApproval() should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NodeInterruptSignal);
        const signal = err as NodeInterruptSignal;
        const val = signal.value as Record<string, unknown>;
        expect(val.__type).toBe("user_input_request");
        expect(val.prompt).toBe("Deploy to production?");
        expect(val.inputType).toBe("boolean");
      }
    });
  });
});

// ----------------------------------------------------------------
// 4. getUserSelection() throws with correct metadata
// ----------------------------------------------------------------

describe("getUserSelection() throws with correct metadata", () => {
  it("includes choices in the interrupt value", async () => {
    await _installInterruptContext({
      nodeName: "selection-node",
      resumeValues: [],
    }, async () => {
      try {
        await getUserSelection("Pick a color", ["red", "green", "blue"]);
        expect.unreachable("getUserSelection() should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NodeInterruptSignal);
        const signal = err as NodeInterruptSignal;
        const val = signal.value as Record<string, unknown>;
        expect(val.__type).toBe("user_input_request");
        expect(val.prompt).toBe("Pick a color");
        expect(val.inputType).toBe("select");
        expect(val.choices).toEqual(["red", "green", "blue"]);
      }
    });
  });
});

// ----------------------------------------------------------------
// 5. HITLSessionStore tracks sessions
// ----------------------------------------------------------------

describe("HITLSessionStore tracks sessions", () => {
  it("records a session and retrieves it by thread", () => {
    const store = new HITLSessionStore<{ count: number }>();

    const iv: InterruptValue = {
      value: { question: "Approve?" },
      node: "approval",
      resumeId: "resume-abc-123",
      timestamp: Date.now(),
    };

    const checkpoint = {
      threadId: "thread-1",
      step: 2,
      state: { count: 42 },
      nextNodes: ["approval"],
      timestamp: Date.now(),
    };

    const session = store.record("thread-1", iv, checkpoint);

    expect(session.threadId).toBe("thread-1");
    expect(session.resumeId).toBe("resume-abc-123");
    expect(session.node).toBe("approval");
    expect(session.status).toBe("pending");
    expect(session.interrupt).toBe(iv);
  });

  it("getByThread returns only pending sessions for the given thread", () => {
    const store = new HITLSessionStore<{ count: number }>();

    const makeIv = (resumeId: string, node: string): InterruptValue => ({
      value: "test",
      node,
      resumeId,
      timestamp: Date.now(),
    });

    const makeCp = (threadId: string) => ({
      threadId,
      step: 0,
      state: { count: 0 },
      nextNodes: [] as string[],
      timestamp: Date.now(),
    });

    store.record("thread-1", makeIv("r1", "nodeA"), makeCp("thread-1"));
    store.record("thread-1", makeIv("r2", "nodeB"), makeCp("thread-1"));
    store.record("thread-2", makeIv("r3", "nodeC"), makeCp("thread-2"));

    const thread1Sessions = store.getByThread("thread-1");
    expect(thread1Sessions).toHaveLength(2);
    expect(thread1Sessions.every((s) => s.threadId === "thread-1")).toBe(true);

    const thread2Sessions = store.getByThread("thread-2");
    expect(thread2Sessions).toHaveLength(1);
    expect(thread2Sessions[0].node).toBe("nodeC");
  });

  it("markResumed updates session status and excludes it from getByThread", () => {
    const store = new HITLSessionStore<{ count: number }>();

    const iv: InterruptValue = {
      value: "test",
      node: "myNode",
      resumeId: "resume-xyz",
      timestamp: Date.now(),
    };

    store.record("thread-1", iv, {
      threadId: "thread-1",
      step: 0,
      state: { count: 0 },
      nextNodes: [],
      timestamp: Date.now(),
    });

    expect(store.getByThread("thread-1")).toHaveLength(1);
    expect(store.pendingCount()).toBe(1);

    store.markResumed("resume-xyz");

    const session = store.get("resume-xyz");
    expect(session).not.toBeNull();
    expect(session!.status).toBe("resumed");

    // getByThread only returns pending sessions
    expect(store.getByThread("thread-1")).toHaveLength(0);
    expect(store.pendingCount()).toBe(0);
  });

  it("all() returns every session regardless of status", () => {
    const store = new HITLSessionStore<{ x: number }>();

    const makeIv = (id: string): InterruptValue => ({
      value: "v",
      node: "n",
      resumeId: id,
      timestamp: Date.now(),
    });
    const cp = { threadId: "t", step: 0, state: { x: 0 }, nextNodes: [] as string[], timestamp: Date.now() };

    store.record("t", makeIv("a"), cp);
    store.record("t", makeIv("b"), cp);
    store.markResumed("a");

    expect(store.all()).toHaveLength(2);
    expect(store.pendingCount()).toBe(1);
  });
});

// ----------------------------------------------------------------
// 6. Resume flow end-to-end
// ----------------------------------------------------------------

describe("Resume flow end-to-end", () => {
  it("graph invoke catches HITLInterruptException, then resume provides value to node", async () => {
    type S = { result: string };

    const g = new StateGraph<S>({
      channels: {
        result: lastValue(() => ""),
      },
    });

    g.addNode("ask", async (_state) => {
      const answer = await interrupt<string>({ question: "What is your name?" });
      return { result: `Hello, ${answer}!` };
    });

    g.addEdge(START, "ask");
    g.addEdge("ask", END);

    const checkpointer = new MemoryCheckpointer<S>();
    const app = g.compile({ checkpointer });

    // First invocation should throw HITLInterruptException
    let caught: HITLInterruptException<S> | null = null;
    try {
      await app.invoke({}, { threadId: "test-thread" });
      expect.unreachable("invoke should have thrown HITLInterruptException");
    } catch (err) {
      expect((err as HITLInterruptException<S>).isHITLInterrupt).toBe(true);
      caught = err as HITLInterruptException<S>;
    }

    expect(caught).not.toBeNull();
    expect(caught!.threadId).toBe("test-thread");
    expect((caught!.interrupt.value as Record<string, unknown>).question).toBe(
      "What is your name?"
    );

    // Resume with a value
    const finalState = await app.resume(
      { threadId: "test-thread", resumeId: caught!.interrupt.resumeId },
      "Alice"
    );

    expect(finalState.result).toBe("Hello, Alice!");
  });

  it("HITLInterruptException exposes isUserInputRequest, prompt, inputType, choices", async () => {
    type S = { selection: string };

    const g = new StateGraph<S>({
      channels: {
        selection: lastValue(() => ""),
      },
    });

    g.addNode("choose", async (_state) => {
      const choice = await getUserSelection("Pick a fruit", ["apple", "banana", "cherry"]);
      return { selection: choice };
    });

    g.addEdge(START, "choose");
    g.addEdge("choose", END);

    const checkpointer = new MemoryCheckpointer<S>();
    const app = g.compile({ checkpointer });

    try {
      await app.invoke({}, { threadId: "select-thread" });
      expect.unreachable("should have thrown");
    } catch (err) {
      const exc = err as HITLInterruptException<S>;
      expect(exc.isHITLInterrupt).toBe(true);
      expect(exc.isUserInputRequest).toBe(true);
      expect(exc.prompt).toBe("Pick a fruit");
      expect(exc.inputType).toBe("select");
      expect(exc.choices).toEqual(["apple", "banana", "cherry"]);
    }
  });

  it("getPendingInterrupts returns sessions for a thread after interrupt", async () => {
    type S = { value: string };

    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("pauser", async () => {
      await interrupt("pause here");
      return { value: "resumed" };
    });

    g.addEdge(START, "pauser");
    g.addEdge("pauser", END);

    const checkpointer = new MemoryCheckpointer<S>();
    const app = g.compile({ checkpointer });

    try {
      await app.invoke({}, { threadId: "pending-thread" });
    } catch {
      // expected
    }

    const pending = app.getPendingInterrupts({ threadId: "pending-thread" });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].threadId).toBe("pending-thread");
    expect(pending[0].node).toBe("pauser");
    expect(pending[0].status).toBe("pending");
  });
});

// ----------------------------------------------------------------
// 7. interrupt() outside context throws
// ----------------------------------------------------------------

describe("interrupt() outside context throws", () => {
  it("throws an error when called outside of a node execution context", async () => {
    // Make sure no context is installed
    _clearInterruptContext();

    await expect(interrupt("some value")).rejects.toThrow(
      "interrupt() called outside of an ONI node execution context"
    );
  });

  it("getUserInput throws outside context", async () => {
    _clearInterruptContext();

    await expect(
      getUserInput({ prompt: "Name?", inputType: "text" })
    ).rejects.toThrow("interrupt() called outside of an ONI node execution context");
  });

  it("getUserApproval throws outside context", async () => {
    _clearInterruptContext();

    await expect(getUserApproval("OK?")).rejects.toThrow(
      "interrupt() called outside of an ONI node execution context"
    );
  });

  it("getUserSelection throws outside context", async () => {
    _clearInterruptContext();

    await expect(getUserSelection("Pick", ["a", "b"])).rejects.toThrow(
      "interrupt() called outside of an ONI node execution context"
    );
  });

  it("context is properly scoped within _installInterruptContext callback", () => {
    _installInterruptContext({
      nodeName: "temp",
      resumeValues: [],
    }, () => {
      expect(_getInterruptContext()).not.toBeNull();
    });
    // After the callback returns, context is no longer available
    expect(_getInterruptContext()).toBeNull();
  });
});

// ----------------------------------------------------------------
// 8. Bug regression — resume() uses resumeId + marks session resumed
// ----------------------------------------------------------------

describe("resume() bug regression", () => {
  it("uses resumeId to identify the correct node (not just first pending)", async () => {
    type S = { nodeA: string; nodeB: string };

    const g = new StateGraph<S>({
      channels: {
        nodeA: lastValue(() => ""),
        nodeB: lastValue(() => ""),
      },
    });

    g.addNode("a", async () => {
      const v = await interrupt<string>("input-a");
      return { nodeA: v };
    });
    g.addNode("b", async () => {
      const v = await interrupt<string>("input-b");
      return { nodeB: v };
    });

    g.addEdge(START, "a");
    g.addEdge("a", END);

    const checkpointer = new MemoryCheckpointer<S>();
    const app = g.compile({ checkpointer });

    let caught: HITLInterruptException<S> | null = null;
    try {
      await app.invoke({}, { threadId: "resume-id-thread" });
    } catch (err) {
      caught = err as HITLInterruptException<S>;
    }

    expect(caught).not.toBeNull();
    const resumeId = caught!.interrupt.resumeId;

    // Resume by specific resumeId — session should be found and resolved
    const result = await app.resume({ threadId: "resume-id-thread", resumeId }, "Alice");
    expect(result.nodeA).toBe("Alice");
  });

  it("marks session as resumed after app.resume() is called", async () => {
    type S = { answer: string };

    const g = new StateGraph<S>({
      channels: { answer: lastValue(() => "") },
    });

    g.addNode("ask", async () => {
      const v = await interrupt<string>("question");
      return { answer: v };
    });

    g.addEdge(START, "ask");
    g.addEdge("ask", END);

    const checkpointer = new MemoryCheckpointer<S>();
    const app = g.compile({ checkpointer });

    let caught: HITLInterruptException<S> | null = null;
    try {
      await app.invoke({}, { threadId: "mark-resumed-thread" });
    } catch (err) {
      caught = err as HITLInterruptException<S>;
    }

    expect(caught).not.toBeNull();
    const resumeId = caught!.interrupt.resumeId;

    // Before resume — should be pending
    const pending = app.getPendingInterrupts({ threadId: "mark-resumed-thread" });
    expect(pending.some((s) => s.resumeId === resumeId && s.status === "pending")).toBe(true);

    // Resume
    await app.resume({ threadId: "mark-resumed-thread", resumeId }, "42");

    // After resume — pending list should no longer include this session
    const stillPending = app.getPendingInterrupts({ threadId: "mark-resumed-thread" });
    expect(stillPending.some((s) => s.resumeId === resumeId)).toBe(false);
  });

  it("rejects a resumeId that belongs to a different thread (cross-thread guard)", async () => {
    type S = { value: string };
    const channels = { value: lastValue(() => "") };

    const makeApp = () => {
      const g = new StateGraph<S>({ channels });
      g.addNode("ask", async () => {
        const v = await interrupt<string>("?");
        return { value: v };
      });
      g.addEdge(START, "ask");
      g.addEdge("ask", END);
      return g.compile({ checkpointer: new MemoryCheckpointer<S>() });
    };

    // Two independent apps, each interrupted on different threads
    const appA = makeApp();
    const appB = makeApp();

    let interruptA: HITLInterruptException<S> | null = null;
    try { await appA.invoke({}, { threadId: "thread-a" }); } catch (e) { interruptA = e as HITLInterruptException<S>; }

    let interruptB: HITLInterruptException<S> | null = null;
    try { await appB.invoke({}, { threadId: "thread-b" }); } catch (e) { interruptB = e as HITLInterruptException<S>; }

    expect(interruptA).not.toBeNull();
    expect(interruptB).not.toBeNull();

    // Attempting to resume thread-a with thread-b's resumeId should throw
    await expect(
      appA.resume({ threadId: "thread-a", resumeId: interruptB!.interrupt.resumeId }, "bad")
    ).rejects.toThrow(/not found or does not belong to thread/);

    // thread-a's session should still be pending (untouched)
    const pendingA = appA.getPendingInterrupts({ threadId: "thread-a" });
    expect(pendingA.some((s) => s.resumeId === interruptA!.interrupt.resumeId && s.status === "pending")).toBe(true);
  });

  it("rejects a completely unknown resumeId", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("ask", async () => { await interrupt("?"); return { value: "x" }; });
    g.addEdge(START, "ask");
    g.addEdge("ask", END);
    const app = g.compile({ checkpointer: new MemoryCheckpointer<S>() });

    try { await app.invoke({}, { threadId: "bad-id-thread" }); } catch { /* expected */ }

    await expect(
      app.resume({ threadId: "bad-id-thread", resumeId: "nonexistent-resume-id" }, "value")
    ).rejects.toThrow(/not found or does not belong to thread/);
  });
});
