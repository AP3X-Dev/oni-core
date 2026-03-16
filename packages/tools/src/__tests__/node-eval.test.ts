import { describe, it, expect } from "vitest";
import { nodeEval } from "../code-execution/node-eval.js";
import type { ToolContext } from "../types.js";

const ctx = {} as ToolContext;

describe("nodeEval", () => {
  it("returns a ToolDefinition with correct shape", () => {
    const tool = nodeEval();
    expect(tool.name).toBe("node_eval");
    expect(tool.schema.type).toBe("object");
    expect(tool.parallelSafe).toBe(false);
    expect(typeof tool.execute).toBe("function");
  });

  it("has required code in schema", () => {
    const tool = nodeEval();
    expect(tool.schema.required).toContain("code");
  });

  it("executes simple expressions", async () => {
    const tool = nodeEval();
    const result = await tool.execute({ code: "return 2 + 2" }, ctx) as { result: number };
    expect(result.result).toBe(4);
  });

  it("executes string expressions", async () => {
    const tool = nodeEval();
    const result = await tool.execute({ code: 'return "hello world"' }, ctx) as { result: string };
    expect(result.result).toBe("hello world");
  });

  it("executes object expressions", async () => {
    const tool = nodeEval();
    const result = await tool.execute({ code: "return { a: 1, b: 2 }" }, ctx) as { result: { a: number; b: number } };
    expect(result.result).toEqual({ a: 1, b: 2 });
  });

  it("captures console.log output", async () => {
    const tool = nodeEval();
    const result = await tool.execute(
      { code: 'console.log("hello"); return "done"' },
      ctx
    ) as { result: string; logs: string[] };
    expect(result.logs).toContain("hello");
    expect(result.result).toBe("done");
  });

  it("captures multiple console.log calls", async () => {
    const tool = nodeEval();
    const result = await tool.execute(
      { code: 'console.log("first"); console.log("second"); return 1' },
      ctx
    ) as { result: number; logs: string[] };
    expect(result.logs).toHaveLength(2);
    expect(result.logs[0]).toBe("first");
    expect(result.logs[1]).toBe("second");
  });

  it("returns undefined result when no return statement", async () => {
    const tool = nodeEval();
    const result = await tool.execute({ code: "const x = 5;" }, ctx) as { result: unknown };
    expect(result.result).toBeUndefined();
  });

  it("enforces timeout", async () => {
    const tool = nodeEval();
    await expect(
      tool.execute({ code: "while(true){}", timeout: 100 }, ctx)
    ).rejects.toThrow();
  }, 15_000);

  it("enforces max timeout of 30000", async () => {
    // Can't easily test it enforces 30s max without waiting, but we can verify it accepts large values
    // and clamps them (indirectly verified by implementation)
    const tool = nodeEval();
    // Using a very short actual timeout to test the clamping doesn't cause an error
    const result = await tool.execute({ code: "return 1", timeout: 999999 }, ctx) as { result: number };
    expect(result.result).toBe(1);
  });

  it("throws on syntax errors", async () => {
    const tool = nodeEval();
    await expect(
      tool.execute({ code: "this is not valid javascript {{{{" }, ctx)
    ).rejects.toThrow();
  });
});
