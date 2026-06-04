import { describe, it, expect, vi } from "vitest";
import { nodeEval } from "../code-execution/node-eval.js";
import { e2bSandbox } from "../code-execution/e2b.js";
import {
  enforceCodeExecutionPolicy,
  type CodeExecutionRuntimePolicyLike,
} from "../runtime-policy.js";
import type { ToolContext } from "../types.js";

const ctx = {} as ToolContext;

/** Build a structural policy whose individual asserts can be made to throw. */
function policy(overrides: Partial<CodeExecutionRuntimePolicyLike> = {}): CodeExecutionRuntimePolicyLike {
  return {
    assertGrantActive: vi.fn(),
    assertCapability: vi.fn(),
    assertNetworkAllowed: vi.fn(),
    ...overrides,
  };
}

describe("enforceCodeExecutionPolicy", () => {
  it("is a no-op when no policy is provided", () => {
    expect(() => enforceCodeExecutionPolicy("node_eval", {}, { requiresNetwork: false })).not.toThrow();
  });

  it("asserts grant, tool capability, and (optionally) network", () => {
    const p = policy();
    enforceCodeExecutionPolicy("e2b_sandbox", { runtimePolicy: p }, { requiresNetwork: true });
    expect(p.assertGrantActive).toHaveBeenCalledOnce();
    expect(p.assertCapability).toHaveBeenCalledWith("tool", "e2b_sandbox");
    expect(p.assertNetworkAllowed).toHaveBeenCalledOnce();
  });

  it("skips the tool-capability check when assertToolCapability is false", () => {
    const p = policy();
    enforceCodeExecutionPolicy("node_eval", { runtimePolicy: p, assertToolCapability: false }, { requiresNetwork: false });
    expect(p.assertCapability).not.toHaveBeenCalled();
    expect(p.assertNetworkAllowed).not.toHaveBeenCalled();
  });
});

describe("nodeEval policy gate", () => {
  it("rejects before executing when the grant is inactive", async () => {
    const p = policy({
      assertGrantActive: vi.fn(() => {
        throw new Error("grant inactive");
      }),
    });
    const tool = nodeEval({ runtimePolicy: p });
    await expect(tool.execute({ code: "return 1" }, ctx)).rejects.toThrow("grant inactive");
  });

  it("rejects when the tool capability is not granted", async () => {
    const p = policy({
      assertCapability: vi.fn(() => {
        throw new Error("tool node_eval not granted");
      }),
    });
    const tool = nodeEval({ runtimePolicy: p });
    await expect(tool.execute({ code: "return 1" }, ctx)).rejects.toThrow("not granted");
  });

  it("executes when the policy permits", async () => {
    const p = policy();
    const tool = nodeEval({ runtimePolicy: p });
    const result = (await tool.execute({ code: "return 21 * 2" }, ctx)) as { result: unknown };
    expect(result.result).toBe(42);
    expect(p.assertGrantActive).toHaveBeenCalled();
  });
});

describe("e2bSandbox policy gate", () => {
  it("rejects when network is not granted", async () => {
    const p = policy({
      assertNetworkAllowed: vi.fn(() => {
        throw new Error("network denied");
      }),
    });
    const tool = e2bSandbox({ apiKey: "k", runtimePolicy: p });
    await expect(tool.execute({ code: "print(1)" }, ctx)).rejects.toThrow("network denied");
  });

  it("passes the policy gate before attempting the sandbox (fails on missing sdk, not policy)", async () => {
    const p = policy();
    const tool = e2bSandbox({ apiKey: "k", runtimePolicy: p });
    // Policy permits → it proceeds and fails on the optional @e2b/sdk import.
    await expect(tool.execute({ code: "print(1)" }, ctx)).rejects.toThrow(/@e2b\/sdk/);
    expect(p.assertNetworkAllowed).toHaveBeenCalledOnce();
  });
});
