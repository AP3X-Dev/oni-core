import { describe, it, expect } from "vitest";
import {
  getConfig, getStore, getStreamWriter,
  _runWithContext, type RunContext,
} from "../context.js";

describe("runtime context", () => {
  it("getConfig() throws outside node execution", () => {
    expect(() => getConfig()).toThrow("getConfig() called outside");
  });

  it("getStore() throws outside node execution", () => {
    expect(() => getStore()).toThrow("getStore() called outside");
  });

  it("getStreamWriter() throws outside node execution", () => {
    expect(() => getStreamWriter()).toThrow("getStreamWriter() called outside");
  });

  it("getConfig() returns config inside _runWithContext", async () => {
    const config = { threadId: "t1", metadata: { foo: "bar" } };
    const ctx: RunContext = {
      config,
      store: null,
      writer: null,
      state: null,
      parentGraph: null,
      parentUpdates: [],
      step: 0,
      recursionLimit: 25,
    };

    let captured: unknown;
    await _runWithContext(ctx, async () => {
      captured = getConfig();
    });

    expect(captured).toBe(config);
  });

  it("getStore() returns null when no store provided", async () => {
    const ctx: RunContext = {
      config: {},
      store: null,
      writer: null,
      state: null,
      parentGraph: null,
      parentUpdates: [],
      step: 0,
      recursionLimit: 25,
    };

    let captured: unknown;
    await _runWithContext(ctx, async () => {
      captured = getStore();
    });

    expect(captured).toBeNull();
  });

  it("nested _runWithContext scopes correctly", async () => {
    const outer: RunContext = {
      config: { threadId: "outer" },
      store: null, writer: null, state: null, parentGraph: null, parentUpdates: [], step: 0, recursionLimit: 25,
    };
    const inner: RunContext = {
      config: { threadId: "inner" },
      store: null, writer: null, state: null, parentGraph: null, parentUpdates: [], step: 0, recursionLimit: 25,
    };

    let outerVal: string | undefined;
    let innerVal: string | undefined;

    await _runWithContext(outer, async () => {
      outerVal = getConfig().threadId;
      await _runWithContext(inner, async () => {
        innerVal = getConfig().threadId;
      });
      // After inner completes, outer context restored
      expect(getConfig().threadId).toBe("outer");
    });

    expect(outerVal).toBe("outer");
    expect(innerVal).toBe("inner");
  });
});
