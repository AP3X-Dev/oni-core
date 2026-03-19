import { describe, it, expect, vi } from "vitest";
import { HooksEngine, type HookResult, type BasePayload, type PreToolUsePayload } from "../harness/hooks-engine.js";

describe("BUG-0028: arg-pattern matcher checks ALL string values, not just first by insertion order", () => {
  it("BUG-0028: should match when the target value is not the first key in the input object", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "deny",
      reason: "blocked",
    });

    const engine = new HooksEngine();
    engine.on("PreToolUse", { matcher: "Bash(git:*)", handler });

    // The dangerous value is the second key — with the old .find() bug this would NOT match
    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { cwd: "/home/user", command: "git push --force" },
    } as PreToolUsePayload);

    // Fix: .some() checks all values → should match and deny
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("BUG-0028: should match when the target value is the first key (baseline — was always correct)", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "deny",
      reason: "blocked",
    });

    const engine = new HooksEngine();
    engine.on("PreToolUse", { matcher: "Bash(git:*)", handler });

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { command: "git status" },
    } as PreToolUsePayload);

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("BUG-0028: should NOT match when no string value matches the arg pattern", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "deny",
      reason: "blocked",
    });

    const engine = new HooksEngine();
    engine.on("PreToolUse", { matcher: "Bash(git:*)", handler });

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { cwd: "/home/user", command: "npm install" },
    } as PreToolUsePayload);

    // No value starts with "git" → handler should not be called, result null
    expect(handler).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
