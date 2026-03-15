import { describe, it, expect } from "vitest";
import { fileSystemTools } from "../filesystem/index.js";

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
    const tools = fileSystemTools({ allowedPaths: ["/tmp/safe"] });
    const readTool = tools.find((t) => t.name === "fs_read_file")!;
    await expect(
      readTool.execute({ path: "/etc/passwd" }, {} as never)
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
});
