import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, NodeExecutionError, ONIError } from "../index.js";

describe("node execution error wrapping", () => {
  it("wraps raw Error in NodeExecutionError for nodes without retry", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("failing", async () => {
      throw new Error("raw-error");
    });
    g.addEdge(START, "failing");
    g.addEdge("failing", END);
    const app = g.compile();

    try {
      await app.invoke({ value: "test" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NodeExecutionError);
      const ne = err as InstanceType<typeof NodeExecutionError>;
      expect(ne.code).toBe("ONI_NODE_EXEC");
      expect(ne.category).toBe("NODE");
      expect(ne.context["node"]).toBe("failing");
      expect(ne.cause).toBeInstanceOf(Error);
      expect((ne.cause as Error).message).toBe("raw-error");
    }
  });

  it("wraps raw Error in NodeExecutionError for nodes without retry (via stream)", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("failing", async () => {
      throw new Error("stream-error");
    });
    g.addEdge(START, "failing");
    g.addEdge("failing", END);
    const app = g.compile();

    try {
      const events: unknown[] = [];
      for await (const evt of app.stream({ value: "test" })) {
        events.push(evt);
      }
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NodeExecutionError);
      const ne = err as InstanceType<typeof NodeExecutionError>;
      expect(ne.context["node"]).toBe("failing");
    }
  });

  it("preserves NodeExecutionError from retry without double-wrapping", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("retrying", async () => {
      throw new Error("retry-fail");
    }, { retry: { maxAttempts: 2, initialDelay: 1 } });
    g.addEdge(START, "retrying");
    g.addEdge("retrying", END);
    const app = g.compile();

    try {
      await app.invoke({ value: "test" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NodeExecutionError);
      const ne = err as InstanceType<typeof NodeExecutionError>;
      expect(ne.code).toBe("ONI_NODE_EXEC");
      expect(ne.context["node"]).toBe("retrying");
      expect(ne.context["attempts"]).toBe(2);
      expect(ne.context["maxAttempts"]).toBe(2);
      // Should NOT be double-wrapped
      expect(ne.cause).toBeInstanceOf(Error);
      expect((ne.cause as Error).message).toBe("retry-fail");
    }
  });

  it("preserves structured ONIErrors (timeout, circuit breaker) without wrapping", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("slow", async () => {
      await new Promise((r) => setTimeout(r, 500));
      return { value: "done" };
    }, { timeout: 10 });
    g.addEdge(START, "slow");
    g.addEdge("slow", END);
    const app = g.compile();

    try {
      await app.invoke({ value: "test" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      // NodeTimeoutError is already an ONIError — should NOT be wrapped in NodeExecutionError
      expect(err).toBeInstanceOf(ONIError);
      expect((err as ONIError).code).toBe("ONI_NODE_TIMEOUT");
    }
  });

  it("wraps non-Error thrown values", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("bad", async () => {
      throw "string-error";
    });
    g.addEdge(START, "bad");
    g.addEdge("bad", END);
    const app = g.compile();

    try {
      await app.invoke({ value: "test" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NodeExecutionError);
      const ne = err as InstanceType<typeof NodeExecutionError>;
      expect(ne.context["node"]).toBe("bad");
    }
  });
});
