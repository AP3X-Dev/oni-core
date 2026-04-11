import { describe, it, expect, afterEach } from "vitest";
import { watchExtensions } from "../watch.js";
import { createTempDir, cleanTempDir, writeExtension, waitFor, createMockRegistry } from "./helpers.js";
import type { HotLoader } from "../types.js";

describe("hot-loader — watch change", () => {
  let tmpDir: string;
  let loader: HotLoader | undefined;

  afterEach(() => {
    loader?.stop();
    cleanTempDir(tmpDir);
  });

  it("hot-swaps when file content changes", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();

    writeExtension(tmpDir, "swap.js", `
      module.exports.alpha = async () => ({
        tool_name: "alpha", success: true, output: "v1",
      });
    `);

    loader = watchExtensions({ dir: tmpDir, registry });
    await waitFor(() => registry.has("alpha"));

    // Overwrite with a different export
    writeExtension(tmpDir, "swap.js", `
      module.exports.beta = async () => ({
        tool_name: "beta", success: true, output: "v2",
      });
    `);

    await waitFor(() => registry.has("beta") && !registry.has("alpha"));
    expect(registry.list()).toContain("beta");
    expect(registry.list()).not.toContain("alpha");
  });

  it("unloads old tools before loading new ones on change", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();
    const unloaded: string[][] = [];

    writeExtension(tmpDir, "cycle.js", `
      module.exports.first = async () => ({
        tool_name: "first", success: true, output: "ok",
      });
    `);

    loader = watchExtensions({
      dir: tmpDir,
      registry,
      onUnload: (_file, tools) => unloaded.push(tools),
    });

    await waitFor(() => registry.has("first"));

    writeExtension(tmpDir, "cycle.js", `
      module.exports.second = async () => ({
        tool_name: "second", success: true, output: "ok",
      });
    `);

    await waitFor(() => registry.has("second"));
    expect(unloaded.flat()).toContain("first");
  });
});
