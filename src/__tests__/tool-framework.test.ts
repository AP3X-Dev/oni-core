import { describe, it, expect, vi } from "vitest";
import { _runWithContext } from "../context.js";
import { defineTool, executeToolCalls } from "../tools/index.js";
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

  it("executeToolCalls runs known tools inside runtime context", async () => {
    const emitted: Array<{ event: string; data: unknown }> = [];
    const tool = defineTool({
      name: "double",
      description: "Double a number",
      schema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
      },
      execute(input: { value: number }, ctx) {
        expect(ctx.config.threadId).toBe("thread-1");
        expect(ctx.state).toEqual({ run: "state" });
        ctx.emit("tool.progress", { value: input.value });
        return input.value * 2;
      },
    });

    const results = await _runWithContext({
      config: { threadId: "thread-1" },
      store: null,
      writer: {
        emit(event, data) {
          emitted.push({ event, data });
        },
        token() {},
      },
      state: { run: "state" },
      parentGraph: null,
      parentUpdates: [],
      step: 0,
      recursionLimit: 10,
    }, () => executeToolCalls([tool], [{ id: "call-1", name: "double", args: { value: 21 } }]));

    expect(results).toEqual([{ toolCallId: "call-1", name: "double", result: 42 }]);
    expect(emitted).toEqual([{ event: "tool.progress", data: { value: 21 } }]);
  });

  it("executeToolCalls returns structured errors for missing tools and invalid args", async () => {
    const tool = defineTool({
      name: "requires_text",
      description: "Requires text",
      schema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      execute(input: { text: string }) {
        return input.text;
      },
    });

    const results = await executeToolCalls([
      tool,
    ], [
      { id: "missing-1", name: "missing", args: {} },
      { id: "invalid-1", name: "requires_text", args: {} },
    ]);

    expect(results[0]).toEqual({
      toolCallId: "missing-1",
      name: "missing",
      result: 'Tool "missing" not found',
      isError: true,
    });
    expect(results[1]).toEqual(expect.objectContaining({
      toolCallId: "invalid-1",
      name: "requires_text",
      isError: true,
    }));
    expect(String(results[1]?.result)).toContain("text");
  });
});
