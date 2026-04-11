import { describe, it, expect, afterEach } from "vitest";
import { watchExtensions } from "../watch.js";
import { createTempDir, cleanTempDir, writeExtension, waitFor, createMockRegistry } from "./helpers.js";
import type { HotLoader } from "../types.js";

describe("hot-loader — watch error", () => {
  let tmpDir: string;
  let loader: HotLoader | undefined;

  afterEach(() => {
    loader?.stop();
    cleanTempDir(tmpDir);
  });

  it("calls onError for a file with a syntax error", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();
    const errors: Array<{ file: string; error: Error }> = [];

    writeExtension(tmpDir, "broken.js", `
      module.exports.good = async () => ({{{{{
    `);

    loader = watchExtensions({
      dir: tmpDir,
      registry,
      onError: (file, error) => errors.push({ file, error }),
    });

    await waitFor(() => errors.length > 0);
    expect(errors[0].error).toBeInstanceOf(Error);
    expect(errors[0].file).toContain("broken.js");
  });

  it("does not unregister other tools when one file fails", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();
    const errors: Error[] = [];

    // Load a good extension first
    writeExtension(tmpDir, "good.js", `
      module.exports.good_tool = async () => ({
        tool_name: "good_tool", success: true, output: "ok",
      });
    `);

    loader = watchExtensions({
      dir: tmpDir,
      registry,
      onError: (_file, error) => errors.push(error),
    });

    await waitFor(() => registry.has("good_tool"));

    // Now add a broken file
    writeExtension(tmpDir, "bad.js", `
      throw new Error("module init failure");
    `);

    await waitFor(() => errors.length > 0);

    // Good tool should still be registered
    expect(registry.has("good_tool")).toBe(true);
  });

  it("skips non-function exports without error", async () => {
    tmpDir = createTempDir();
    const registry = createMockRegistry();
    const errors: Error[] = [];

    writeExtension(tmpDir, "mixed.js", `
      module.exports.notAFunction = "I am a string";
      module.exports.realTool = async () => ({
        tool_name: "realTool", success: true, output: "ok",
      });
    `);

    loader = watchExtensions({
      dir: tmpDir,
      registry,
      onError: (_file, error) => errors.push(error),
    });

    await waitFor(() => registry.has("realTool"));
    expect(errors).toHaveLength(0);
    expect(registry.has("notAFunction")).toBe(false);
  });
});
