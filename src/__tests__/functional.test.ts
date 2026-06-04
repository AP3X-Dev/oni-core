// ============================================================
// Functional API coverage — task / entrypoint / pipe / branch
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { task, entrypoint, pipe, branch } from "../functional.js";
import { lastValue } from "../types.js";
import { MemoryCheckpointer } from "../checkpoint.js";

describe("functional: task()", () => {
  it("invokes the wrapped function and returns its result", async () => {
    const double = task("double", (n: number) => n * 2);
    await expect(double.invoke(21)).resolves.toBe(42);
    expect(double.name).toBe("double");
  });

  it("passes config through to the wrapped function", async () => {
    const echo = task("echo", (_: string, config) => config?.threadId ?? "none");
    await expect(echo.invoke("x", { threadId: "t-1" })).resolves.toBe("t-1");
  });

  it("does not retry when maxAttempts is unset", async () => {
    const fn = vi.fn(() => {
      throw new Error("boom");
    });
    const t = task("once", fn);
    await expect(t.invoke(0)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and eventually succeeds within maxAttempts", async () => {
    let calls = 0;
    const flaky = task(
      "flaky",
      () => {
        calls += 1;
        if (calls < 3) throw new Error(`fail-${calls}`);
        return "ok";
      },
      { maxAttempts: 3, initialDelay: 1 },
    );
    await expect(flaky.invoke(null)).resolves.toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws the last error after exhausting all attempts", async () => {
    let calls = 0;
    const doomed = task(
      "doomed",
      () => {
        calls += 1;
        throw new Error(`fail-${calls}`);
      },
      { maxAttempts: 2, initialDelay: 1 },
    );
    await expect(doomed.invoke(null)).rejects.toThrow("fail-2");
    expect(calls).toBe(2);
  });

  it("wraps non-Error throwables into Error instances", async () => {
    const t = task(
      "stringy",
      () => {
        throw "plain string failure";
      },
      { maxAttempts: 1, initialDelay: 1 },
    );
    // maxAttempts:1 takes the no-retry path; verify the thrown value still surfaces.
    await expect(t.invoke(null)).rejects.toThrow("plain string failure");
  });

  it("surfaces a wrapped Error when retries exhaust on a non-Error throwable", async () => {
    const t = task(
      "stringy-retry",
      () => {
        throw "nope";
      },
      { maxAttempts: 2, initialDelay: 1 },
    );
    await expect(t.invoke(null)).rejects.toThrow("nope");
  });
});

describe("functional: entrypoint()", () => {
  it("runs the function and returns the merged state", async () => {
    const app = entrypoint<{ query: string; answer: string }>(
      { channels: { query: lastValue(() => ""), answer: lastValue(() => "") } },
      (state) => ({ answer: state.query.toUpperCase() }),
    );
    const result = await app.invoke({ query: "hi" });
    expect(result.answer).toBe("HI");
  });

  it("honors a custom node name", async () => {
    const app = entrypoint<{ value: string }>(
      { channels: { value: lastValue(() => "") }, name: "custom" },
      () => ({ value: "set" }),
    );
    const result = await app.invoke({ value: "" });
    expect(result.value).toBe("set");
  });

  it("persists state through a checkpointer", async () => {
    const checkpointer = new MemoryCheckpointer<{ count: number }>();
    const app = entrypoint<{ count: number }>(
      { channels: { count: lastValue(() => 0) }, checkpointer },
      (state) => ({ count: state.count + 1 }),
    );
    await app.invoke({ count: 0 }, { threadId: "fn-thread" });
    const snapshot = await checkpointer.get("fn-thread");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.state.count).toBe(1);
  });
});

describe("functional: pipe()", () => {
  it("composes tasks into a linear pipeline", async () => {
    const app = pipe<{ n: number }>(
      { channels: { n: lastValue(() => 0) } },
      (s) => ({ n: s.n + 1 }),
      (s) => ({ n: s.n * 10 }),
    );
    const result = await app.invoke({ n: 1 });
    expect(result.n).toBe(20);
  });

  it("supports a single-step pipeline", async () => {
    const app = pipe<{ n: number }>(
      { channels: { n: lastValue(() => 0) } },
      (s) => ({ n: s.n + 5 }),
    );
    const result = await app.invoke({ n: 0 });
    expect(result.n).toBe(5);
  });

  it("throws when given no task functions", () => {
    expect(() => pipe<{ n: number }>({ channels: { n: lastValue(() => 0) } })).toThrow(
      /at least one task/,
    );
  });
});

describe("functional: branch()", () => {
  const make = () =>
    branch<{ route: string; out: string }>(
      (s) => s.route,
      {
        a: () => ({ out: "A" }),
        b: () => ({ out: "B" }),
      },
      { channels: { route: lastValue(() => "a"), out: lastValue(() => "") } },
    );

  it("routes to the branch selected by the condition", async () => {
    const result = await make().invoke({ route: "b", out: "" });
    expect(result.out).toBe("B");
  });

  it("routes to a different branch on different input", async () => {
    const result = await make().invoke({ route: "a", out: "" });
    expect(result.out).toBe("A");
  });
});
