import { describe, it, expect } from "vitest";
import { DynamicToolRegistry } from "../../registry/index.js";
import type { DynamicToolState } from "../../registry/index.js";
import type { ToolResult } from "../../registry/index.js";

describe("DynamicToolRegistry — unknown tool", () => {
  it("returns structured error for unregistered tool name", async () => {
    const registry = new DynamicToolRegistry();

    registry.register("known_tool", async () => ({
      tool_name: "known_tool",
      success: true,
      output: "ok",
    }));

    const node = registry.asNode();
    const state: DynamicToolState = {
      messages: [],
      pendingTools: [{ name: "nonexistent", args: {}, id: "tc-1" }],
    };

    const result = await node(state);
    const partial = result as Partial<DynamicToolState>;

    expect(partial.messages).toHaveLength(1);

    const msg = partial.messages![0];
    expect(msg.role).toBe("tool");
    expect(msg.name).toBe("nonexistent");
    expect(msg.tool_call_id).toBe("tc-1");

    const body: ToolResult = JSON.parse(msg.content);
    expect(body.success).toBe(false);
    expect(body.error).toContain("nonexistent");
    expect(body.error).toContain("not registered");
  });

  it("lists available tools in the error message", async () => {
    const registry = new DynamicToolRegistry();

    registry.register("alpha", async () => ({
      tool_name: "alpha", success: true, output: "ok",
    }));
    registry.register("beta", async () => ({
      tool_name: "beta", success: true, output: "ok",
    }));

    const node = registry.asNode();
    const state: DynamicToolState = {
      messages: [],
      pendingTools: [{ name: "gamma", args: {}, id: "tc-2" }],
    };

    const result = await node(state);
    const partial = result as Partial<DynamicToolState>;
    const body: ToolResult = JSON.parse(partial.messages![0].content);

    expect(body.error).toContain("alpha");
    expect(body.error).toContain("beta");
  });

  it("does not throw — error stays in the message for LLM self-correction", async () => {
    const registry = new DynamicToolRegistry();
    const node = registry.asNode();

    const state: DynamicToolState = {
      messages: [],
      pendingTools: [{ name: "missing", args: {}, id: "tc-3" }],
    };

    // Should NOT throw — the error is returned as a structured result
    await expect(node(state)).resolves.toBeDefined();
  });
});
