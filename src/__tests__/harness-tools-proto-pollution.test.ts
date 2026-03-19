import { describe, it, expect, vi } from "vitest";
import { executeTools, buildToolMap } from "../harness/loop/tools.js";

describe("executeTools — prototype pollution sanitization (BUG-0024)", () => {
  function makeCtx(hooksEngine, toolMap) {
    return {
      sessionId: "sess-1",
      threadId: "thread-1",
      turn: 1,
      config: {
        agentName: "test-agent",
        hooksEngine,
      },
      toolMap,
      hasMemoryLoader: false,
    };
  }

  it("BUG-0024: __proto__ in hook modifiedInput does not pollute Object prototype", async () => {
    // Before the fix: Object.assign(toolCall.args, preResult.modifiedInput) with a
    // __proto__ key would pollute Object.prototype, escalating privileges globally.
    // After the fix: __proto__, constructor, and prototype keys are stripped via
    // recursive Object.fromEntries + Object.entries filter before the merge.

    const capturedArgs = { value: null };
    const spyTool = {
      name: "SpyTool",
      description: "Captures args",
      schema: null,
      execute: vi.fn((args) => {
        capturedArgs.value = args;
        return "ok";
      }),
    };

    // Mock hooksEngine whose fire() returns modifiedInput containing __proto__
    const mockHooksEngine = {
      fire: vi.fn().mockResolvedValue({
        decision: "allow",
        modifiedInput: {
          safe: "legit-value",
          __proto__: { isAdmin: true },
          constructor: { polluted: true },
          prototype: { owned: true },
        },
      }),
    };

    const toolMap = buildToolMap([spyTool]);
    await executeTools(
      [{ id: "tc-1", name: "SpyTool", args: { safe: "original" } }],
      makeCtx(mockHooksEngine, toolMap),
    );

    expect(spyTool.execute).toHaveBeenCalledOnce();

    // Legitimate key was merged via modifiedInput
    expect(capturedArgs.value.safe).toBe("legit-value");

    // Prototype pollution must NOT have occurred
    const probe = {};
    expect(probe.isAdmin).toBeUndefined();
    expect(probe.polluted).toBeUndefined();
    expect(probe.owned).toBeUndefined();

    // The args object itself must not have __proto__ as own enumerable property
    expect(Object.prototype.hasOwnProperty.call(capturedArgs.value, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(capturedArgs.value, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(capturedArgs.value, "prototype")).toBe(false);
  });

  it("BUG-0024: nested __proto__ in modifiedInput is also stripped recursively", async () => {
    // The fix uses recursive stripProtoKeys, so deeply nested __proto__ is also removed.

    const capturedArgs = { value: null };
    const spyTool = {
      name: "SpyTool",
      description: "Captures args",
      schema: null,
      execute: vi.fn((args) => {
        capturedArgs.value = args;
        return "ok";
      }),
    };

    const mockHooksEngine = {
      fire: vi.fn().mockResolvedValue({
        decision: "allow",
        modifiedInput: {
          nested: {
            safe: "value",
            __proto__: { deepPolluted: true },
          },
        },
      }),
    };

    const toolMap = buildToolMap([spyTool]);
    await executeTools(
      [{ id: "tc-2", name: "SpyTool", args: { nested: {} } }],
      makeCtx(mockHooksEngine, toolMap),
    );

    expect(spyTool.execute).toHaveBeenCalledOnce();

    // Nested safe value was merged
    expect(capturedArgs.value.nested?.safe).toBe("value");

    // Deep prototype pollution must not have occurred
    const probe = {};
    expect(probe.deepPolluted).toBeUndefined();
  });
});
