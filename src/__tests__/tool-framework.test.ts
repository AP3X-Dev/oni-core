import { describe, it, expect, vi } from "vitest";
import { defineTool } from "../tools/index.js";
import type { ToolContext } from "../tools/index.js";

describe("tool framework", () => {
  it("defineTool creates a valid ToolDefinition", () => {
    const tool = defineTool({
      name: "calculator",
      description: "Performs arithmetic",
      schema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
          op: { type: "string", enum: ["+", "-", "*", "/"] },
        },
        required: ["a", "b", "op"],
      },
      execute: (input: { a: number; b: number; op: string }) => {
        switch (input.op) {
          case "+": return input.a + input.b;
          case "-": return input.a - input.b;
          case "*": return input.a * input.b;
          case "/": return input.a / input.b;
          default: throw new Error(`Unknown op: ${input.op}`);
        }
      },
    });

    expect(tool.name).toBe("calculator");
    expect(tool.description).toBe("Performs arithmetic");
    expect(tool.schema).toHaveProperty("type", "object");
    expect(typeof tool.execute).toBe("function");
  });

  it("tool execute receives ToolContext when called directly", async () => {
    let capturedCtx: ToolContext | undefined;

    const tool = defineTool({
      name: "echo",
      description: "Echoes input with context info",
      schema: { type: "object", properties: { text: { type: "string" } } },
      execute: (input: { text: string }, ctx: ToolContext) => {
        capturedCtx = ctx;
        return `echo: ${input.text}`;
      },
    });

    const mockCtx: ToolContext = {
      config: { threadId: "t1", metadata: { key: "value" } },
      store: null,
      state: { counter: 42 },
      emit: () => {},
    };

    const result = await tool.execute({ text: "hello" }, mockCtx);

    expect(result).toBe("echo: hello");
    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.config.threadId).toBe("t1");
    expect(capturedCtx!.state).toEqual({ counter: 42 });
    expect(capturedCtx!.store).toBeNull();
  });

  it("tool can emit events via context", async () => {
    const emitFn = vi.fn();

    const tool = defineTool({
      name: "emitter",
      description: "Emits custom events",
      schema: { type: "object", properties: { value: { type: "number" } } },
      execute: (input: { value: number }, ctx: ToolContext) => {
        ctx.emit("progress", { percent: 50 });
        ctx.emit("progress", { percent: 100 });
        return input.value * 2;
      },
    });

    const mockCtx: ToolContext = {
      config: {},
      store: null,
      state: {},
      emit: emitFn,
    };

    const result = await tool.execute({ value: 21 }, mockCtx);

    expect(result).toBe(42);
    expect(emitFn).toHaveBeenCalledTimes(2);
    expect(emitFn).toHaveBeenCalledWith("progress", { percent: 50 });
    expect(emitFn).toHaveBeenCalledWith("progress", { percent: 100 });
  });
});
