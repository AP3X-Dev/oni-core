import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSystemTools } from "../filesystem/index.js";

// Cross-platform test paths
const SAFE_DIR = join(tmpdir(), "oni-test-safe");
const OUTSIDE_DIR = join(tmpdir(), "..", "oni-outside-boundary");

describe("fileSystemTools", () => {
  it("returns an array of ToolDefinitions", () => {
    const tools = fileSystemTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("all tools have names starting with fs_", () => {
    const tools = fileSystemTools();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^fs_/);
    }
  });

  it("all tools have schema defined", () => {
    const tools = fileSystemTools();
    for (const tool of tools) {
      expect(tool.schema).toBeDefined();
      expect(tool.schema.type).toBe("object");
    }
  });

  it("includes expected tool names", () => {
    const tools = fileSystemTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("fs_read_file");
    expect(names).toContain("fs_write_file");
    expect(names).toContain("fs_list_directory");
    expect(names).toContain("fs_create_directory");
    expect(names).toContain("fs_delete_file");
    expect(names).toContain("fs_get_file_info");
  });

  it("returns 6 tools", () => {
    const tools = fileSystemTools();
    expect(tools).toHaveLength(6);
  });

  it("read and write tools require path", () => {
    const tools = fileSystemTools();
    const readTool = tools.find((t) => t.name === "fs_read_file")!;
    const writeTool = tools.find((t) => t.name === "fs_write_file")!;
    expect(readTool.schema.required).toContain("path");
    expect(writeTool.schema.required).toContain("path");
    expect(writeTool.schema.required).toContain("content");
  });

  it("enforces allowedPaths security boundary", async () => {
    const tools = fileSystemTools({ allowedPaths: [SAFE_DIR] });
    const readTool = tools.find((t) => t.name === "fs_read_file")!;
    await expect(
      readTool.execute({ path: OUTSIDE_DIR }, {} as never)
    ).rejects.toThrow("Access denied");
  });

  it("read_file tool is parallelSafe", () => {
    const tools = fileSystemTools();
    const readTool = tools.find((t) => t.name === "fs_read_file")!;
    expect(readTool.parallelSafe).toBe(true);
  });

  it("write_file tool is not parallelSafe", () => {
    const tools = fileSystemTools();
    const writeTool = tools.find((t) => t.name === "fs_write_file")!;
    expect(writeTool.parallelSafe).toBe(false);
  });

  it("no-args call defaults to cwd and rejects paths outside it", async () => {
    const tools = fileSystemTools();
    const readTool = tools.find((t) => t.name === "fs_read_file")!;
    await expect(
      readTool.execute({ path: OUTSIDE_DIR }, {} as never)
    ).rejects.toThrow("Access denied");
  });

  it("allowedPaths: [] rejects all paths (empty means no access)", async () => {
    const tools = fileSystemTools({ allowedPaths: [] });
    const readTool = tools.find((t) => t.name === "fs_read_file")!;
    await expect(
      readTool.execute({ path: join(tmpdir(), "anything") }, {} as never)
    ).rejects.toThrow("Access denied");
  });

  it("explicit allowedPaths allows listed paths and rejects others", async () => {
    const tools = fileSystemTools({ allowedPaths: [tmpdir()] });
    const readTool = tools.find((t) => t.name === "fs_read_file")!;
    // Path outside tmpdir must be rejected
    await expect(
      readTool.execute({ path: OUTSIDE_DIR }, {} as never)
    ).rejects.toThrow("Access denied");
    // Path inside tmpdir must pass the allowedPaths check (may fail with ENOENT, not Access denied)
    try {
      await readTool.execute({ path: join(tmpdir(), ".oni-test-nonexistent-file") }, {} as never);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("Access denied");
    }
  });
});
