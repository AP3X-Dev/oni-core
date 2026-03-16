import { describe, it, expect } from "vitest";
import { HooksEngine, type PreToolUsePayload } from "../harness/hooks-engine.js";

describe("HooksEngine.withSecurityGuardrails", () => {
  it("BUG-0008: should block eval-based rm -rf bypass", async () => {
    const engine = HooksEngine.withSecurityGuardrails();

    const result = await engine.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "Bash",
      input: { command: 'eval "rm -rf /"' },
    } as PreToolUsePayload);

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
  });
});
