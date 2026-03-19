import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "../types.js";

const ctx = {} as ToolContext;

describe("BUG-0007: E2B sandbox is always closed after execution", () => {
  it("BUG-0007: should call sandbox.close() even when runCode throws", async () => {
    const closeFn = vi.fn().mockResolvedValue(undefined);
    const mockSandbox = {
      runCode: vi.fn().mockRejectedValue(new Error("execution failed")),
      close: closeFn,
    };

    vi.doMock("@e2b/sdk", () => ({
      Sandbox: {
        create: vi.fn().mockResolvedValue(mockSandbox),
      },
    }));

    const { e2bSandbox } = await import("../code-execution/e2b.js");
    const tool = e2bSandbox({ apiKey: "test-key" });

    await expect(tool.execute({ code: "throw 'boom'" }, ctx)).rejects.toThrow(
      "execution failed"
    );

    expect(closeFn).toHaveBeenCalledTimes(1);

    vi.doUnmock("@e2b/sdk");
  });

  it("BUG-0007: should call sandbox.close() on successful execution", async () => {
    const closeFn = vi.fn().mockResolvedValue(undefined);
    const mockSandbox = {
      runCode: vi.fn().mockResolvedValue({
        stdout: "hello",
        stderr: "",
        exitCode: 0,
      }),
      close: closeFn,
    };

    vi.doMock("@e2b/sdk", () => ({
      Sandbox: {
        create: vi.fn().mockResolvedValue(mockSandbox),
      },
    }));

    const { e2bSandbox } = await import("../code-execution/e2b.js");
    const tool = e2bSandbox({ apiKey: "test-key" });

    const result = await tool.execute({ code: "print('hello')" }, ctx);

    expect(result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
    expect(closeFn).toHaveBeenCalledTimes(1);

    vi.doUnmock("@e2b/sdk");
  });
});
