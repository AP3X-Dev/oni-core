import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSystemTools, type RuntimePolicyLike } from "../filesystem/index.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "oni-fs-policy-"));
}

function context() {
  return {} as never;
}

describe("fileSystemTools runtimePolicy integration", () => {
  it("delegates path and tool capability checks to runtimePolicy when provided", async () => {
    const dir = tempDir();
    const filePath = join(dir, "allowed.txt");
    writeFileSync(filePath, "policy-content");

    const calls: string[] = [];
    const runtimePolicy: RuntimePolicyLike = {
      assertGrantActive() {
        calls.push("grant");
      },
      assertCapability(type, name) {
        calls.push(`${type}:${name ?? ""}`);
      },
      assertPathAllowed(path) {
        calls.push(`path:${path}`);
        return filePath;
      },
    };

    try {
      const tools = fileSystemTools({ allowedPaths: [], runtimePolicy });
      const readTool = tools.find((tool) => tool.name === "fs_read_file")!;
      const result = await readTool.execute({ path: "input.txt" }, context()) as { content: string };

      expect(result.content).toBe("policy-content");
      expect(calls).toEqual(["grant", "tool:fs_read_file", "path:input.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not touch the filesystem when runtimePolicy denies a path", async () => {
    const dir = tempDir();
    const filePath = join(dir, "denied.txt");

    const runtimePolicy: RuntimePolicyLike = {
      assertGrantActive() {},
      assertCapability() {},
      assertPathAllowed() {
        throw new Error("platform path denied");
      },
    };

    try {
      const tools = fileSystemTools({ allowedPaths: [dir], runtimePolicy });
      const writeTool = tools.find((tool) => tool.name === "fs_write_file")!;

      await expect(
        writeTool.execute({ path: filePath, content: "should-not-write" }, context()),
      ).rejects.toThrow("platform path denied");
      expect(existsSync(filePath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can skip tool capability checks while still enforcing runtime paths", async () => {
    const dir = tempDir();
    const filePath = join(dir, "write.txt");

    const runtimePolicy: RuntimePolicyLike = {
      assertGrantActive() {},
      assertCapability() {
        throw new Error("tool capability should not be checked");
      },
      assertPathAllowed() {
        return filePath;
      },
    };

    try {
      const tools = fileSystemTools({ runtimePolicy, assertToolCapability: false });
      const writeTool = tools.find((tool) => tool.name === "fs_write_file")!;

      await writeTool.execute({ path: "write.txt", content: "written" }, context());
      expect(readFileSync(filePath, "utf8")).toBe("written");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
