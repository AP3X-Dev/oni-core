// Regression test for BUG-0382
// Before the fix: Object.assign(toolCall.args, sanitized) merges the hook's
// modifiedInput into the original args, so keys absent from the hook output
// survive — the hook cannot remove or redact individual argument fields.
// After the fix: toolCall.args = sanitized replaces the args entirely with
// the hook's output, ensuring that keys the hook intentionally omits are gone.

import { describe, it, expect, vi } from "vitest";
import { executeTools, buildToolMap } from "../harness/loop/tools.js";

function makeCtx(hooksEngine: unknown, toolMap: Map<string, unknown>) {
  return {
    sessionId: "sess-bug-0382",
    threadId: "thread-bug-0382",
    turn: 1,
    config: {
      agentName: "test-agent",
      hooksEngine,
    },
    toolMap,
    hasMemoryLoader: false,
  };
}

describe("executeTools — hook modifiedInput replaces args entirely (BUG-0382)", () => {
  it("BUG-0382: keys absent from hook modifiedInput are removed from toolCall.args", async () => {
    // Before the fix: Object.assign(toolCall.args, sanitized) preserved original
    // keys like "secret" even when the hook deliberately omitted them from its
    // modifiedInput — the hook's redaction was silently ignored.
    // After the fix: toolCall.args = sanitized — only the hook's output keys survive.

    const capturedArgs: { value: unknown } = { value: null };

    const spyTool = {
      name: "SpyTool",
      description: "Captures args for inspection",
      schema: null,
      execute: vi.fn((args: unknown) => {
        capturedArgs.value = args;
        return "ok";
      }),
    };

    // Hook that deliberately omits "secret" from its modifiedInput,
    // intending to redact it before the tool executes.
    const mockHooksEngine = {
      fire: vi.fn().mockResolvedValue({
        decision: "allow",
        modifiedInput: {
          safe: "redacted-value",
          // "secret" key intentionally absent — hook is redacting it
        },
      }),
    };

    const toolMap = buildToolMap([spyTool]);

    await executeTools(
      [
        {
          id: "tc-bug-0382",
          name: "SpyTool",
          args: {
            safe: "original-value",
            secret: "sensitive-data-must-not-reach-tool",
          },
        },
      ],
      makeCtx(mockHooksEngine, toolMap) as any,
    );

    expect(spyTool.execute).toHaveBeenCalledOnce();

    const args = capturedArgs.value as Record<string, unknown>;

    // The hook's replacement value must reach the tool
    expect(args.safe).toBe("redacted-value");

    // The "secret" key was intentionally omitted from modifiedInput —
    // it must NOT be present in the args seen by the tool.
    // (Before the fix, Object.assign preserved it; after the fix it is gone.)
    expect(Object.prototype.hasOwnProperty.call(args, "secret")).toBe(false);
    expect(args.secret).toBeUndefined();
  });

  it("BUG-0382: hook modifiedInput with empty object clears all original args", async () => {
    // Edge case: hook returns {} to block all arguments — tool must receive
    // an empty args object, not the original args passed through.

    const capturedArgs: { value: unknown } = { value: null };

    const spyTool = {
      name: "SpyTool",
      description: "Captures args for inspection",
      schema: null,
      execute: vi.fn((args: unknown) => {
        capturedArgs.value = args;
        return "ok";
      }),
    };

    const mockHooksEngine = {
      fire: vi.fn().mockResolvedValue({
        decision: "allow",
        modifiedInput: {},
      }),
    };

    const toolMap = buildToolMap([spyTool]);

    await executeTools(
      [
        {
          id: "tc-bug-0382b",
          name: "SpyTool",
          args: { keyA: "valueA", keyB: "valueB", keyC: "valueC" },
        },
      ],
      makeCtx(mockHooksEngine, toolMap) as any,
    );

    expect(spyTool.execute).toHaveBeenCalledOnce();

    const args = capturedArgs.value as Record<string, unknown>;

    // After full replacement with {}, no original keys should survive
    expect(Object.keys(args)).toHaveLength(0);
    expect(args.keyA).toBeUndefined();
    expect(args.keyB).toBeUndefined();
    expect(args.keyC).toBeUndefined();
  });
});
