import { describe, it, expect, afterEach } from "vitest";
import { watchExtensions } from "../watch.js";
import { createTempDir, cleanTempDir, writeExtension, waitFor, createMockRegistry } from "./helpers.js";
import type { HotLoader } from "../types.js";

describe("hot-loader — watch add", () => {
  let tmpDir: string;
  let loader: HotLoader | undefined;

  afterEach(() => {
    loader?.stop();
    cleanTempDir(tmpDir);
  });

  it("loads an extension file and registers its exported function", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();
    const loaded: string[][] = [];

    writeExtension(tmpDir, "greet.js", `
      module.exports.greet = async (args) => ({
        tool_name: "greet",
        success: true,
        output: "Hello " + args.name,
      });
    `);

    loader = watchExtensions({
      dir: tmpDir,
      registry,
      onLoad: (_file, tools) => loaded.push(tools),
    });

    await waitFor(() => registry.has("greet"));
    expect(registry.list()).toContain("greet");
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    expect(loaded.flat()).toContain("greet");
  });

  it("registers multiple exports from a single file", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();

    writeExtension(tmpDir, "multi.js", `
      module.exports.tool_a = async () => ({
        tool_name: "tool_a", success: true, output: "a",
      });
      module.exports.tool_b = async () => ({
        tool_name: "tool_b", success: true, output: "b",
      });
    `);

    loader = watchExtensions({ dir: tmpDir, registry });

    await waitFor(() => registry.has("tool_a") && registry.has("tool_b"));
    expect(registry.list()).toContain("tool_a");
    expect(registry.list()).toContain("tool_b");
  });

  it("uses schema.name as tool name when .schema is present", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();

    writeExtension(tmpDir, "named.js", `
      const handler = async (args) => ({
        tool_name: "custom_name", success: true, output: "ok",
      });
      handler.schema = {
        name: "custom_name",
        description: "A custom tool",
        parameters: { type: "object", properties: {} },
      };
      module.exports.my_export = handler;
    `);

    loader = watchExtensions({ dir: tmpDir, registry });

    await waitFor(() => registry.has("custom_name"));
    expect(registry.list()).toContain("custom_name");
  });
});
