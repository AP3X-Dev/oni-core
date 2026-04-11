import { describe, it, expect, afterEach } from "vitest";
import { watchExtensions } from "../watch.js";
import { createTempDir, cleanTempDir, writeExtension, waitFor, createMockRegistry } from "./helpers.js";
import type { HotLoader } from "../types.js";

describe("hot-loader — watch schema", () => {
  let tmpDir: string;
  let loader: HotLoader | undefined;

  afterEach(() => {
    loader?.stop();
    cleanTempDir(tmpDir);
  });

  it("passes .schema metadata to registry.register()", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();

    writeExtension(tmpDir, "with-schema.js", `
      const handler = async (args) => ({
        tool_name: "search_web",
        success: true,
        output: "results for " + args.query,
      });
      handler.schema = {
        name: "search_web",
        description: "Search the web for current information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      };
      module.exports.search_web = handler;
    `);

    loader = watchExtensions({ dir: tmpDir, registry });
    await waitFor(() => registry.has("search_web"));

    const entry = registry._tools.get("search_web")!;
    expect(entry.opts).toEqual({
      description: "Search the web for current information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    });
  });

  it("falls back to export name when schema has no name", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();

    writeExtension(tmpDir, "no-name.js", `
      const handler = async () => ({
        tool_name: "my_export", success: true, output: "ok",
      });
      handler.schema = {
        description: "Has a description but no name",
        parameters: { type: "object", properties: {} },
      };
      module.exports.my_export = handler;
    `);

    loader = watchExtensions({ dir: tmpDir, registry });
    await waitFor(() => registry.has("my_export"));
    expect(registry.list()).toContain("my_export");
  });

  it("registers without opts when handler has no .schema", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();

    writeExtension(tmpDir, "bare.js", `
      module.exports.bare_tool = async () => ({
        tool_name: "bare_tool", success: true, output: "ok",
      });
    `);

    loader = watchExtensions({ dir: tmpDir, registry });
    await waitFor(() => registry.has("bare_tool"));

    const entry = registry._tools.get("bare_tool")!;
    expect(entry.opts.description).toBeUndefined();
    expect(entry.opts.parameters).toBeUndefined();
  });
});
