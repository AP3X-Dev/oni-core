import { describe, it, expect } from "vitest";
import { HooksEngine, type PreToolUsePayload } from "../harness/hooks-engine.js";

async function checkBash(command: string) {
  const engine = HooksEngine.withSecurityGuardrails();
  return engine.fire("PreToolUse", {
    sessionId: "test",
    toolName: "Bash",
    input: { command },
  } as PreToolUsePayload);
}

describe("BUG-0296: base64-encoded payload bypass of dangerousBashPatterns", () => {
  it("BUG-0296: blocks base64 -d piped to sh", async () => {
    const result = await checkBash('echo "cm0gLXJmIC8=" | base64 -d | sh');
    expect(result?.decision).toBe("deny");
  });

  it("BUG-0296: blocks base64 -d piped to bash", async () => {
    const result = await checkBash('echo "cm0gLXJmIC8=" | base64 -d | bash');
    expect(result?.decision).toBe("deny");
  });

  it("BUG-0296: blocks base64 --decode piped to sh", async () => {
    const result = await checkBash('echo "payload" | base64 --decode | sh');
    expect(result?.decision).toBe("deny");
  });
});
