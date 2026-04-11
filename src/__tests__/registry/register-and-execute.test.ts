import { describe, it, expect } from "vitest";
import { DynamicToolRegistry } from "../../registry/index.js";
import type { DynamicToolState } from "../../registry/index.js";
import type { ToolResult } from "../../registry/index.js";

describe("DynamicToolRegistry — register and execute", () => {
  it("registers a tool and executes it via asNode()", async () => {
    const registry = new DynamicToolRegistry();

    registry.register("greet", async (args) => ({
      tool_name: "greet",
      success: true,
      output: `Hello, ${args.name}!`,
    }));

    const node = registry.asNode();

    const state: DynamicToolState = {
      messages: [],
      pendingTools: [{ name: "greet", args: { name: "World" }, id: "tc-1" }],
    };

    const result = await node(state);
    expect(result).toBeDefined();

    const partial = result as Partial<DynamicToolState>;
    expect(partial.messages).toHaveLength(1);

    const msg = partial.messages![0];
    expect(msg.role).toBe("tool");
    expect(msg.name).toBe("greet");
    expect(msg.tool_call_id).toBe("tc-1");

    const body: ToolResult = JSON.parse(msg.content);
    expect(body.success).toBe(true);
    expect(body.output).toBe("Hello, World!");
    expect(body.tool_name).toBe("greet");
  });

  it("returns empty update when pendingTools is empty", async () => {
    const registry = new DynamicToolRegistry();
    registry.register("noop", async () => ({
      tool_name: "noop",
      success: true,
      output: "ok",
    }));

    const node = registry.asNode();
    const result = await node({ messages: [], pendingTools: [] });
    expect(result).toEqual({});
  });

  it("passes state to handler as second argument", async () => {
    const registry = new DynamicToolRegistry();
    let capturedState: Record<string, unknown> | undefined;

    registry.register("spy", async (_args, state) => {
      capturedState = state;
      return { tool_name: "spy", success: true, output: "ok" };
    });

    const node = registry.asNode();
    const state: DynamicToolState = {
      messages: [{ role: "user", content: "hi" }],
      pendingTools: [{ name: "spy", args: {}, id: "tc-2" }],
    };

    await node(state);
    expect(capturedState).toBeDefined();
    expect((capturedState as DynamicToolState).messages).toHaveLength(1);
  });

  it("catches handler exceptions and returns structured error", async () => {
    const registry = new DynamicToolRegistry();

    registry.register("boom", async () => {
      throw new Error("something broke");
    });

    const node = registry.asNode();
    const state: DynamicToolState = {
      messages: [],
      pendingTools: [{ name: "boom", args: {}, id: "tc-3" }],
    };

    const result = await node(state);
    const partial = result as Partial<DynamicToolState>;
    expect(partial.messages).toHaveLength(1);

    const body: ToolResult = JSON.parse(partial.messages![0].content);
    expect(body.success).toBe(false);
    expect(body.error).toBe("something broke");
    expect(body.tool_name).toBe("boom");
  });
});
