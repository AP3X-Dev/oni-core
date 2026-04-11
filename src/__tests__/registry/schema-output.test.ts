import { describe, it, expect } from "vitest";
import { DynamicToolRegistry } from "../../registry/index.js";

describe("DynamicToolRegistry — asSchema()", () => {
  it("returns empty array when no tools registered", () => {
    const registry = new DynamicToolRegistry();
    expect(registry.asSchema()).toEqual([]);
  });

  it("returns valid function-calling schema for registered tools", () => {
    const registry = new DynamicToolRegistry();

    registry.register("read_file", async () => ({
      tool_name: "read_file", success: true, output: "ok",
    }), {
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    });

    registry.register("write_file", async () => ({
      tool_name: "write_file", success: true, output: "ok",
    }), {
      description: "Write a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    });

    registry.register("search", async () => ({
      tool_name: "search", success: true, output: "ok",
    }), {
      description: "Search the web",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    });

    const schemas = registry.asSchema();
    expect(schemas).toHaveLength(3);

    // All entries have the correct shape
    for (const entry of schemas) {
      expect(entry.type).toBe("function");
      expect(entry.function).toHaveProperty("name");
      expect(entry.function).toHaveProperty("description");
      expect(entry.function).toHaveProperty("parameters");
      expect(typeof entry.function.name).toBe("string");
      expect(typeof entry.function.description).toBe("string");
    }

    // Check specific tools
    const names = schemas.map((s) => s.function.name);
    expect(names).toEqual(["read_file", "write_file", "search"]);

    // Check parameter schemas preserved
    const readFile = schemas.find((s) => s.function.name === "read_file")!;
    expect(readFile.function.description).toBe("Read a file");
    expect(readFile.function.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    });

    const writeFile = schemas.find((s) => s.function.name === "write_file")!;
    expect(writeFile.function.parameters).toHaveProperty("properties.path");
    expect(writeFile.function.parameters).toHaveProperty("properties.content");
  });

  it("reflects live changes — unregistered tools disappear from schema", () => {
    const registry = new DynamicToolRegistry();

    registry.register("a", async () => ({
      tool_name: "a", success: true, output: "ok",
    }), { description: "Tool A" });

    registry.register("b", async () => ({
      tool_name: "b", success: true, output: "ok",
    }), { description: "Tool B" });

    expect(registry.asSchema()).toHaveLength(2);

    registry.unregister("a");
    const schemas = registry.asSchema();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].function.name).toBe("b");
  });

  it("uses default description and parameters when opts omitted", () => {
    const registry = new DynamicToolRegistry();

    registry.register("bare", async () => ({
      tool_name: "bare", success: true, output: "ok",
    }));

    const schemas = registry.asSchema();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].function.description).toBe("");
    expect(schemas[0].function.parameters).toEqual({
      type: "object",
      properties: {},
    });
  });
});
