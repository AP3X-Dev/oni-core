import { describe, it, expect } from "vitest";
import { DynamicToolRegistry } from "../../registry/index.js";
import type { DynamicToolState } from "../../registry/index.js";
import type { ToolResult } from "../../registry/index.js";

describe("DynamicToolRegistry — register / unregister lifecycle", () => {
  it("list() reflects registrations", () => {
    const registry = new DynamicToolRegistry();
    expect(registry.list()).toEqual([]);

    registry.register("a", async () => ({
      tool_name: "a", success: true, output: "ok",
    }));
    expect(registry.list()).toEqual(["a"]);

    registry.register("b", async () => ({
      tool_name: "b", success: true, output: "ok",
    }));
    expect(registry.list()).toEqual(["a", "b"]);
  });

  it("unregister removes the tool from list()", () => {
    const registry = new DynamicToolRegistry();

    registry.register("x", async () => ({
      tool_name: "x", success: true, output: "ok",
    }));
    registry.register("y", async () => ({
      tool_name: "y", success: true, output: "ok",
    }));

    expect(registry.list()).toContain("x");
    expect(registry.unregister("x")).toBe(true);
    expect(registry.list()).not.toContain("x");
    expect(registry.list()).toContain("y");
  });

  it("unregister returns false for unknown tool", () => {
    const registry = new DynamicToolRegistry();
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("has() returns correct value before and after unregister", () => {
    const registry = new DynamicToolRegistry();

    registry.register("tool", async () => ({
      tool_name: "tool", success: true, output: "ok",
    }));

    expect(registry.has("tool")).toBe(true);
    expect(registry.has("other")).toBe(false);

    registry.unregister("tool");
    expect(registry.has("tool")).toBe(false);
  });

  it("calling unregistered tool via asNode returns error result", async () => {
    const registry = new DynamicToolRegistry();

    registry.register("temp", async () => ({
      tool_name: "temp", success: true, output: "ok",
    }));

    // Verify it works first
    const node = registry.asNode();
    const state: DynamicToolState = {
      messages: [],
      pendingTools: [{ name: "temp", args: {}, id: "tc-1" }],
    };

    const good = await node(state);
    const goodBody: ToolResult = JSON.parse(
      (good as Partial<DynamicToolState>).messages![0].content
    );
    expect(goodBody.success).toBe(true);

    // Now unregister and try again
    registry.unregister("temp");

    const bad = await node(state);
    const badBody: ToolResult = JSON.parse(
      (bad as Partial<DynamicToolState>).messages![0].content
    );
    expect(badBody.success).toBe(false);
    expect(badBody.error).toContain("not registered");
  });

  it("register() replaces existing handler (hot-swap)", async () => {
    const registry = new DynamicToolRegistry();

    registry.register("swap", async () => ({
      tool_name: "swap", success: true, output: "v1",
    }));

    const node = registry.asNode();
    const state: DynamicToolState = {
      messages: [],
      pendingTools: [{ name: "swap", args: {}, id: "tc-1" }],
    };

    const r1 = await node(state);
    const b1: ToolResult = JSON.parse(
      (r1 as Partial<DynamicToolState>).messages![0].content
    );
    expect(b1.output).toBe("v1");

    // Replace with v2
    registry.register("swap", async () => ({
      tool_name: "swap", success: true, output: "v2",
    }));

    const r2 = await node(state);
    const b2: ToolResult = JSON.parse(
      (r2 as Partial<DynamicToolState>).messages![0].content
    );
    expect(b2.output).toBe("v2");
  });

  it("register() returns this for chaining", () => {
    const registry = new DynamicToolRegistry();
    const returned = registry.register("a", async () => ({
      tool_name: "a", success: true, output: "ok",
    }));
    expect(returned).toBe(registry);
  });
});
