import { describe, it, expect, afterEach } from "vitest";
import { watchExtensions } from "../watch.js";
import { createTempDir, cleanTempDir, writeExtension, removeExtension, waitFor, createMockRegistry } from "./helpers.js";
import type { HotLoader } from "../types.js";

describe("hot-loader — watch remove", () => {
  let tmpDir: string;
  let loader: HotLoader | undefined;

  afterEach(() => {
    loader?.stop();
    cleanTempDir(tmpDir);
  });

  it("unregisters tools when file is deleted", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();
    const unloaded: string[][] = [];

    const filePath = writeExtension(tmpDir, "temp.js", `
      module.exports.temp_tool = async () => ({
        tool_name: "temp_tool", success: true, output: "ok",
      });
    `);

    loader = watchExtensions({
      dir: tmpDir,
      registry,
      onUnload: (_file, tools) => unloaded.push(tools),
    });

    await waitFor(() => registry.has("temp_tool"));

    removeExtension(filePath);

    await waitFor(() => !registry.has("temp_tool"));
    expect(registry.list()).not.toContain("temp_tool");
    expect(unloaded.flat()).toContain("temp_tool");
  });

  it("loaded() map no longer contains the file after deletion", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();

    const filePath = writeExtension(tmpDir, "gone.js", `
      module.exports.gone = async () => ({
        tool_name: "gone", success: true, output: "ok",
      });
    `);

    loader = watchExtensions({ dir: tmpDir, registry });
    await waitFor(() => registry.has("gone"));

    const beforeDelete = loader.loaded();
    expect(beforeDelete.size).toBe(1);

    removeExtension(filePath);
    await waitFor(() => !registry.has("gone"));

    const afterDelete = loader.loaded();
    expect(afterDelete.size).toBe(0);
  });
});
