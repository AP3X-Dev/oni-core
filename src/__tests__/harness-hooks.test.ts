import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HooksEngine,
  type HookResult,
  type HooksConfig,
  type BasePayload,
  type PreToolUsePayload,
  type StopPayload,
} from "../harness/hooks-engine.js";

describe("HooksEngine", () => {
  let engine: HooksEngine;

  beforeEach(() => {
    engine = new HooksEngine();
  });

  // ── 1. Fires registered hooks and returns null when all pass ───────

  it("fires registered hooks and returns null when all pass", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "allow",
    });

    engine.on("PreToolUse", { handler });

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { command: "ls" },
    } as PreToolUsePayload);

    expect(handler).toHaveBeenCalledOnce();
    expect(result).toBeNull();
  });

  // ── 2. Returns deny result immediately ─────────────────────────────

  it("returns deny result immediately", async () => {
    const allowHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "allow",
    });
    const denyHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "deny",
      reason: "blocked by policy",
    });
    const neverHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "allow",
    });

    engine.on("PreToolUse", { handler: allowHandler });
    engine.on("PreToolUse", { handler: denyHandler });
    engine.on("PreToolUse", { handler: neverHandler });

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { command: "rm -rf /" },
    } as PreToolUsePayload);

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
    expect(result!.reason).toBe("blocked by policy");
    // The third handler should not be called after deny
    expect(neverHandler).not.toHaveBeenCalled();
  });

  // ── 3. Matcher filters by tool name using pipe-separated OR ────────

  it("matcher filters by tool name using pipe-separated OR", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "allow",
    });

    engine.on("PreToolUse", { matcher: "Write|Edit", handler });

    // Should match "Write"
    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Write",
      input: {},
    } as PreToolUsePayload);
    expect(handler).toHaveBeenCalledTimes(1);

    // Should match "Edit"
    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Edit",
      input: {},
    } as PreToolUsePayload);
    expect(handler).toHaveBeenCalledTimes(2);

    // Should NOT match "Bash"
    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  // ── 4. Stop hook can block with feedback ───────────────────────────

  it("Stop hook can block with feedback", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "block",
      reason: "Response lacks test coverage discussion",
    });

    engine.on("Stop", { handler });

    const result = await engine.fire("Stop", {
      sessionId: "s1",
      response: "Here is the code",
    } as StopPayload);

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("block");
    expect(result!.reason).toBe("Response lacks test coverage discussion");
  });

  // ── 5. Aggregates additionalContext from multiple hooks ────────────

  it("aggregates additionalContext from multiple hooks", async () => {
    engine.on("PreToolUse", {
      handler: async () => ({
        decision: "allow",
        additionalContext: "Note: this file is auto-generated",
      }),
    });
    engine.on("PreToolUse", {
      handler: async () => ({
        decision: "allow",
        additionalContext: "Reminder: run tests after edit",
      }),
    });

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Edit",
      input: {},
    } as PreToolUsePayload);

    // When all allow but provide additionalContext, fire returns an allow result
    // with aggregated context
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("allow");
    expect(result!.additionalContext).toContain("this file is auto-generated");
    expect(result!.additionalContext).toContain("run tests after edit");
  });

  // ── 6. configure() registers multiple events ──────────────────────

  it("configure() registers multiple events", async () => {
    const preHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({ decision: "allow" });
    const postHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({ decision: "allow" });

    const config: HooksConfig = {
      PreToolUse: [{ handler: preHandler }],
      PostToolUse: [{ handler: postHandler }],
    };

    engine.configure(config);

    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    await engine.fire("PostToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
      output: "ok",
    } as BasePayload);

    expect(preHandler).toHaveBeenCalledOnce();
    expect(postHandler).toHaveBeenCalledOnce();
  });

  // ── 7. Hook timeout abandons slow hooks ────────────────────────────

  it("hook timeout abandons slow hooks", async () => {
    const slowHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ decision: "deny" }), 5000)),
    );

    engine.on("PreToolUse", { handler: slowHandler, timeout: 50 });

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    // Timed-out PreToolUse hook fails closed for security
    expect(result).toEqual({ decision: "deny", reason: "Hook timeout — fail-closed for security" });
  });

  // ── 8. compose() merges multiple engines ───────────────────────────

  it("compose() merges multiple engines", async () => {
    const engine1 = new HooksEngine();
    const engine2 = new HooksEngine();

    const h1 = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({ decision: "allow" });
    const h2 = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({ decision: "allow" });

    engine1.on("PreToolUse", { handler: h1 });
    engine2.on("PostToolUse", { handler: h2 });

    const composed = HooksEngine.compose(engine1, engine2);

    await composed.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    await composed.fire("PostToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
      output: "ok",
    } as BasePayload);

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  // ── 9. withSecurityGuardrails blocks dangerous bash patterns ───────

  it("withSecurityGuardrails blocks dangerous bash patterns", async () => {
    const secEngine = HooksEngine.withSecurityGuardrails();

    // rm -rf
    const r1 = await secEngine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { command: "rm -rf /important" },
    } as PreToolUsePayload);
    expect(r1).not.toBeNull();
    expect(r1!.decision).toBe("deny");

    // .env file access
    const r2 = await secEngine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Read",
      input: { file_path: "/home/user/.env" },
    } as PreToolUsePayload);
    expect(r2).not.toBeNull();
    expect(r2!.decision).toBe("deny");

    // Safe command should pass
    const r3 = await secEngine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { command: "git status" },
    } as PreToolUsePayload);
    expect(r3).toBeNull();
  });

  // ── 10. onAny listener receives all events ─────────────────────────

  it("onAny listener receives all events", async () => {
    const listener = vi.fn();
    engine.onAny(listener);

    engine.on("PreToolUse", {
      handler: async () => ({ decision: "allow" as const }),
    });
    engine.on("Stop", {
      handler: async () => ({ decision: "allow" as const }),
    });

    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    await engine.fire("Stop", {
      sessionId: "s1",
      response: "done",
    } as StopPayload);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith("PreToolUse", expect.objectContaining({ toolName: "Bash" }));
    expect(listener).toHaveBeenCalledWith("Stop", expect.objectContaining({ response: "done" }));
  });

  // ── 11. clear() removes all hooks ──────────────────────────────────

  it("clear() removes all hooks", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "deny",
      reason: "nope",
    });

    engine.on("PreToolUse", { handler });
    engine.clear();

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // ── 12. off() removes hooks for a specific event ───────────────────

  it("off() removes hooks for a specific event only", async () => {
    const preHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({ decision: "allow" });
    const stopHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({ decision: "allow" });

    engine.on("PreToolUse", { handler: preHandler });
    engine.on("Stop", { handler: stopHandler });

    engine.off("PreToolUse");

    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    await engine.fire("Stop", {
      sessionId: "s1",
      response: "done",
    } as StopPayload);

    expect(preHandler).not.toHaveBeenCalled();
    expect(stopHandler).toHaveBeenCalledOnce();
  });

  // ── 13. Wildcard matcher matches all tools ─────────────────────────

  it("wildcard matcher matches all tools", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({ decision: "allow" });

    engine.on("PreToolUse", { matcher: "*", handler });

    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Write",
      input: {},
    } as PreToolUsePayload);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  // ── 14. Bash(git:*) arg pattern matching ───────────────────────────

  it("Bash(git:*) arg pattern matches tool with matching input", async () => {
    const handler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({ decision: "allow" });

    engine.on("PreToolUse", { matcher: "Bash(git:*)", handler });

    // Should match: Bash with command starting with "git"
    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { command: "git push origin main" },
    } as PreToolUsePayload);
    expect(handler).toHaveBeenCalledTimes(1);

    // Should NOT match: Bash with non-git command
    await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { command: "npm install" },
    } as PreToolUsePayload);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ── 15. withQualityGate creates a Stop hook ────────────────────────

  it("withQualityGate creates a Stop hook that validates responses", async () => {
    const validate = vi.fn<(response: string) => string | null>().mockImplementation(
      (response: string) => {
        if (!response.includes("test")) {
          return "Missing test coverage";
        }
        return null;
      },
    );

    const qgEngine = HooksEngine.withQualityGate(validate);

    // Response without "test" should be blocked
    const r1 = await qgEngine.fire("Stop", {
      sessionId: "s1",
      response: "Here is the implementation",
    } as StopPayload);
    expect(r1).not.toBeNull();
    expect(r1!.decision).toBe("block");
    expect(r1!.reason).toBe("Missing test coverage");

    // Response with "test" should pass
    const r2 = await qgEngine.fire("Stop", {
      sessionId: "s1",
      response: "Here is the implementation with test coverage",
    } as StopPayload);
    expect(r2).toBeNull();
  });

  // ── 16. block result short-circuits ────────────────────────────────

  it("block result short-circuits like deny", async () => {
    const blockHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "block",
      reason: "blocked",
    });
    const afterHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockResolvedValue({
      decision: "allow",
    });

    engine.on("PreToolUse", { handler: blockHandler });
    engine.on("PreToolUse", { handler: afterHandler });

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("block");
    expect(afterHandler).not.toHaveBeenCalled();
  });

  // ── 17. Handler errors are caught silently ─────────────────────────

  it("handler errors are caught silently", async () => {
    const badHandler = vi.fn<(payload: BasePayload) => Promise<HookResult>>().mockRejectedValue(
      new Error("hook crashed"),
    );

    engine.on("PreToolUse", { handler: badHandler });

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: {},
    } as PreToolUsePayload);

    // Crashed PreToolUse hooks fail closed for security
    expect(result).toEqual({ decision: "deny", reason: "Hook error: fail-closed for security" });
  });
});
