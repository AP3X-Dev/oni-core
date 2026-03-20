// Regression test for BUG-0287
// Before the fix, stripProtoKeys() was only applied to preResult.modifiedInput (hook path).
// The original toolCall.args from the LLM was forwarded to execute() without sanitization.
// The fix adds toolCall.args = stripProtoKeys(toolCall.args) unconditionally at line 96,
// before any hook invocation, ensuring all tool executions receive clean input.

import { describe, it, expect, vi } from "vitest";
import { executeTools, buildToolMap } from "../harness/loop/tools.js";

function makeCtx(hooksEngine: unknown, toolMap: Map<string, unknown>) {
  return {
    sessionId: "sess-bug-0287",
    threadId: "thread-bug-0287",
    turn: 1,
    config: {
      agentName: "test-agent",
      hooksEngine,
    },
    toolMap,
    hasMemoryLoader: false,
  };
}

describe("executeTools — direct LLM args proto stripping (BUG-0287)", () => {
  it("BUG-0287: __proto__ in LLM-supplied toolCall.args is stripped before hook invocation and execute()", async () => {
    // Before the fix: toolCall.args arrived from JSON.parse(LLM output) and was passed
    // directly to PreToolUse hook AND execute() without any sanitization.
    // After the fix: stripProtoKeys(toolCall.args) runs at the top of the per-tool loop
    // unconditionally, before hook invocation.

    const capturedArgs: { value: unknown } = { value: null };
    const capturedHookInput: { value: unknown } = { value: null };

    const spyTool = {
      name: "SpyTool",
      description: "Captures args",
      schema: null,
      execute: vi.fn((args: unknown) => {
        capturedArgs.value = args;
        return "ok";
      }),
    };

    // Hook that captures what it receives — should also see cleaned input
    const mockHooksEngine = {
      fire: vi.fn(async (_event: string, payload: { input: unknown }) => {
        capturedHookInput.value = payload.input;
        return { decision: "allow" as const };
      }),
    };

    const toolMap = buildToolMap([spyTool]);

    // Simulate LLM-supplied args with prototype-polluting keys
    const llmSuppliedArgs: Record<string, unknown> = {
      legitimate: "safe-value",
    };
    // Manually set __proto__ key as own property (simulating JSON.parse of
    // {"__proto__": {"isAdmin": true}} which creates it as an own property)
    Object.defineProperty(llmSuppliedArgs, "__proto__", {
      value: { isAdmin: true },
      writable: true,
      enumerable: true,
      configurable: true,
    });

    await executeTools(
      [{ id: "tc-bug-0287", name: "SpyTool", args: llmSuppliedArgs }],
      makeCtx(mockHooksEngine, toolMap) as any,
    );

    expect(spyTool.execute).toHaveBeenCalledOnce();

    // The legitimate arg must be present
    expect((capturedArgs.value as Record<string, unknown>).legitimate).toBe("safe-value");

    // __proto__ must NOT be an own enumerable property on the args seen by execute()
    expect(
      Object.prototype.hasOwnProperty.call(capturedArgs.value, "__proto__"),
    ).toBe(false);

    // No prototype pollution must have occurred on Object.prototype
    const probe: Record<string, unknown> = {};
    expect(probe.isAdmin).toBeUndefined();

    // The hook must also have received clean input (proto keys stripped before hook call)
    expect(
      Object.prototype.hasOwnProperty.call(capturedHookInput.value, "__proto__"),
    ).toBe(false);
  });

  it("BUG-0287: constructor and prototype keys in LLM args are stripped before execute()", async () => {
    const capturedArgs: { value: unknown } = { value: null };

    const spyTool = {
      name: "SpyTool",
      description: "Captures args",
      schema: null,
      execute: vi.fn((args: unknown) => {
        capturedArgs.value = args;
        return "ok";
      }),
    };

    const toolMap = buildToolMap([spyTool]);

    // Simulate LLM args with constructor and prototype own properties
    const llmSuppliedArgs: Record<string, unknown> = { data: "value" };
    Object.defineProperty(llmSuppliedArgs, "constructor", {
      value: { polluted: true },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(llmSuppliedArgs, "prototype", {
      value: { injected: true },
      writable: true,
      enumerable: true,
      configurable: true,
    });

    // No hooks — ensures stripping happens independent of hook presence
    await executeTools(
      [{ id: "tc-bug-0287b", name: "SpyTool", args: llmSuppliedArgs }],
      makeCtx(undefined, toolMap) as any,
    );

    expect(spyTool.execute).toHaveBeenCalledOnce();
    expect((capturedArgs.value as Record<string, unknown>).data).toBe("value");

    // Polluting own-enumerable keys must be stripped
    expect(
      Object.prototype.hasOwnProperty.call(capturedArgs.value, "constructor"),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(capturedArgs.value, "prototype"),
    ).toBe(false);
  });
});
