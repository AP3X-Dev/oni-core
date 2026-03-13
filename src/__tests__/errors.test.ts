import { describe, it, expect } from "vitest";
import {
  ONIError,
  InvalidSkeletonError,
  RecursionLimitError,
  NodeNotFoundError,
  EdgeConflictError,
  NodeExecutionError,
  NodeTimeoutError,
  CircuitBreakerOpenError,
  SwarmDeadlockError,
  ModelRateLimitError,
  ModelContextLengthError,
  CheckpointCorruptError,
  StoreKeyNotFoundError,
  ONIInterrupt,
} from "../errors.js";
import type { ErrorCategory } from "../errors.js";

// ── Helpers ───────────────────────────────────────────────────

function assertONIError(
  err: ONIError,
  expected: {
    name: string;
    code: string;
    category: ErrorCategory;
    recoverable: boolean;
    hasSuggestion: boolean;
    contextKeys?: string[];
  },
) {
  expect(err).toBeInstanceOf(Error);
  expect(err).toBeInstanceOf(ONIError);
  expect(err.name).toBe(expected.name);
  expect(err.code).toBe(expected.code);
  expect(err.category).toBe(expected.category);
  expect(err.recoverable).toBe(expected.recoverable);
  if (expected.hasSuggestion) {
    expect(err.suggestion.length).toBeGreaterThan(0);
  }
  if (expected.contextKeys) {
    for (const key of expected.contextKeys) {
      expect(err.context).toHaveProperty(key);
    }
  }
  // toJSON round-trip
  const json = err.toJSON();
  expect(json.code).toBe(expected.code);
  expect(json.category).toBe(expected.category);
  expect(json.message).toBe(err.message);
  expect(json.recoverable).toBe(expected.recoverable);
  expect(typeof json.stack).toBe("string");
}

// ── Tests ─────────────────────────────────────────────────────

describe("ONIError base class", () => {
  it("accepts message-only (backward compat)", () => {
    const err = new ONIError("something broke");
    expect(err.message).toBe("something broke");
    expect(err.code).toBe("ONI_UNKNOWN");
    expect(err.category).toBe("GRAPH");
    expect(err.recoverable).toBe(false);
    expect(err.suggestion).toBe("");
    expect(err.context).toEqual({});
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts message + options", () => {
    const err = new ONIError("custom", {
      code: "ONI_TEST",
      category: "CONFIG",
      recoverable: true,
      suggestion: "Try again",
      context: { foo: 1 },
    });
    expect(err.code).toBe("ONI_TEST");
    expect(err.category).toBe("CONFIG");
    expect(err.recoverable).toBe(true);
    expect(err.suggestion).toBe("Try again");
    expect(err.context).toEqual({ foo: 1 });
  });

  it("toJSON() returns structured representation", () => {
    const err = new ONIError("msg", {
      code: "ONI_X",
      category: "STREAM",
      recoverable: false,
      suggestion: "fix it",
      context: { a: 2 },
    });
    const json = err.toJSON();
    expect(json).toMatchObject({
      name: "ONIError",
      code: "ONI_X",
      category: "STREAM",
      message: "msg",
      recoverable: false,
      suggestion: "fix it",
      context: { a: 2 },
    });
    expect(typeof json.stack).toBe("string");
  });
});

describe("InvalidSkeletonError", () => {
  it("has correct fields", () => {
    const err = new InvalidSkeletonError("bad graph");
    expect(err.message).toBe("bad graph");
    assertONIError(err, {
      name: "InvalidSkeletonError",
      code: "ONI_GRAPH_INVALID",
      category: "GRAPH",
      recoverable: false,
      hasSuggestion: true,
    });
    expect(err).toBeInstanceOf(InvalidSkeletonError);
    expect(err).toBeInstanceOf(ONIError);
  });
});

describe("RecursionLimitError", () => {
  it("has correct fields", () => {
    const err = new RecursionLimitError(25);
    expect(err.message).toContain("25");
    assertONIError(err, {
      name: "RecursionLimitError",
      code: "ONI_RECURSION_LIMIT",
      category: "GRAPH",
      recoverable: false,
      hasSuggestion: true,
      contextKeys: ["limit"],
    });
    expect(err.context.limit).toBe(25);
  });
});

describe("NodeNotFoundError", () => {
  it("has correct fields", () => {
    const err = new NodeNotFoundError("myNode");
    expect(err.message).toContain("myNode");
    assertONIError(err, {
      name: "NodeNotFoundError",
      code: "ONI_NODE_MISSING",
      category: "NODE",
      recoverable: false,
      hasSuggestion: true,
      contextKeys: ["node"],
    });
    expect(err.context.node).toBe("myNode");
  });
});

describe("EdgeConflictError", () => {
  it("has correct fields", () => {
    const err = new EdgeConflictError("a", "b");
    expect(err.message).toContain("a");
    expect(err.message).toContain("b");
    assertONIError(err, {
      name: "EdgeConflictError",
      code: "ONI_EDGE_CONFLICT",
      category: "EDGE",
      recoverable: false,
      hasSuggestion: true,
      contextKeys: ["from", "to"],
    });
    expect(err.context.from).toBe("a");
    expect(err.context.to).toBe("b");
  });
});

describe("NodeExecutionError", () => {
  it("has correct fields and preserves cause", () => {
    const cause = new Error("boom");
    const err = new NodeExecutionError("worker", cause);
    expect(err.message).toContain("worker");
    expect(err.message).toContain("boom");
    expect(err.cause).toBe(cause);
    assertONIError(err, {
      name: "NodeExecutionError",
      code: "ONI_NODE_EXEC",
      category: "NODE",
      recoverable: false,
      hasSuggestion: true,
      contextKeys: ["node"],
    });
    expect(err.context.node).toBe("worker");
  });
});

describe("NodeTimeoutError", () => {
  it("has correct fields", () => {
    const err = new NodeTimeoutError("slowNode", 5000);
    expect(err.message).toContain("slowNode");
    expect(err.message).toContain("5000");
    assertONIError(err, {
      name: "NodeTimeoutError",
      code: "ONI_NODE_TIMEOUT",
      category: "NODE",
      recoverable: true,
      hasSuggestion: true,
      contextKeys: ["node", "timeoutMs"],
    });
    expect(err.context.node).toBe("slowNode");
    expect(err.context.timeoutMs).toBe(5000);
  });
});

describe("CircuitBreakerOpenError", () => {
  it("has correct fields", () => {
    const err = new CircuitBreakerOpenError("flaky", 30000);
    expect(err.message).toContain("flaky");
    expect(err.message).toContain("30000");
    assertONIError(err, {
      name: "CircuitBreakerOpenError",
      code: "ONI_NODE_CIRCUIT_OPEN",
      category: "NODE",
      recoverable: true,
      hasSuggestion: true,
      contextKeys: ["node", "resetAfterMs"],
    });
    expect(err.context.node).toBe("flaky");
    expect(err.context.resetAfterMs).toBe(30000);
  });
});

describe("SwarmDeadlockError", () => {
  it("has correct fields", () => {
    const agents = ["agentA", "agentB", "agentC"];
    const err = new SwarmDeadlockError(agents);
    expect(err.message).toContain("agentA");
    expect(err.message).toContain("agentB");
    expect(err.message).toContain("agentC");
    assertONIError(err, {
      name: "SwarmDeadlockError",
      code: "ONI_SWARM_DEADLOCK",
      category: "SWARM",
      recoverable: false,
      hasSuggestion: true,
      contextKeys: ["agents"],
    });
    expect(err.context.agents).toEqual(agents);
  });
});

describe("ModelRateLimitError", () => {
  it("has correct fields with retryAfterMs", () => {
    const err = new ModelRateLimitError("openai", 2000);
    expect(err.message).toContain("openai");
    expect(err.message).toContain("2000");
    assertONIError(err, {
      name: "ModelRateLimitError",
      code: "ONI_MODEL_RATE_LIMIT",
      category: "MODEL",
      recoverable: true,
      hasSuggestion: true,
      contextKeys: ["provider", "retryAfterMs"],
    });
    expect(err.context.provider).toBe("openai");
    expect(err.context.retryAfterMs).toBe(2000);
  });

  it("works without retryAfterMs", () => {
    const err = new ModelRateLimitError("anthropic");
    expect(err.message).toContain("anthropic");
    expect(err.context.provider).toBe("anthropic");
    expect(err.context).not.toHaveProperty("retryAfterMs");
    expect(err.recoverable).toBe(true);
  });
});

describe("ModelContextLengthError", () => {
  it("has correct fields", () => {
    const err = new ModelContextLengthError("openai", 128000);
    expect(err.message).toContain("openai");
    expect(err.message).toContain("128000");
    assertONIError(err, {
      name: "ModelContextLengthError",
      code: "ONI_MODEL_CONTEXT",
      category: "MODEL",
      recoverable: false,
      hasSuggestion: true,
      contextKeys: ["provider", "maxTokens"],
    });
    expect(err.context.provider).toBe("openai");
    expect(err.context.maxTokens).toBe(128000);
  });
});

describe("CheckpointCorruptError", () => {
  it("has correct fields", () => {
    const err = new CheckpointCorruptError("thread-42", "checksum mismatch");
    expect(err.message).toContain("thread-42");
    expect(err.message).toContain("checksum mismatch");
    assertONIError(err, {
      name: "CheckpointCorruptError",
      code: "ONI_CHECKPOINT_CORRUPT",
      category: "CHECKPOINT",
      recoverable: false,
      hasSuggestion: true,
      contextKeys: ["threadId", "detail"],
    });
    expect(err.context.threadId).toBe("thread-42");
    expect(err.context.detail).toBe("checksum mismatch");
  });
});

describe("StoreKeyNotFoundError", () => {
  it("has correct fields", () => {
    const err = new StoreKeyNotFoundError(["users", "prefs"], "theme");
    expect(err.message).toContain("theme");
    expect(err.message).toContain("users.prefs");
    assertONIError(err, {
      name: "StoreKeyNotFoundError",
      code: "ONI_STORE_KEY",
      category: "STORE",
      recoverable: false,
      hasSuggestion: true,
      contextKeys: ["namespace", "key"],
    });
    expect(err.context.namespace).toEqual(["users", "prefs"]);
    expect(err.context.key).toBe("theme");
  });
});

describe("ONIInterrupt (unchanged)", () => {
  it("is not an Error", () => {
    const intr = new ONIInterrupt("nodeX", "before", { count: 1 });
    expect(intr).not.toBeInstanceOf(Error);
    expect(intr.isONIInterrupt).toBe(true);
    expect(intr.node).toBe("nodeX");
    expect(intr.timing).toBe("before");
    expect(intr.state).toEqual({ count: 1 });
  });
});

describe("instanceof chains", () => {
  it("all error subclasses are instanceof ONIError and Error", () => {
    const errors = [
      new InvalidSkeletonError("x"),
      new RecursionLimitError(10),
      new NodeNotFoundError("x"),
      new EdgeConflictError("a", "b"),
      new NodeExecutionError("x", new Error("y")),
      new NodeTimeoutError("x", 1000),
      new CircuitBreakerOpenError("x", 5000),
      new SwarmDeadlockError(["a"]),
      new ModelRateLimitError("p"),
      new ModelContextLengthError("p", 100),
      new CheckpointCorruptError("t", "d"),
      new StoreKeyNotFoundError(["n"], "k"),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ONIError);
    }
  });
});
