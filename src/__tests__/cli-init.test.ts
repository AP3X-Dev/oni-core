import { describe, it, expect, afterEach } from "vitest";
import { initProject } from "../cli/init.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("cli init", () => {
  const testDir = join(tmpdir(), `oni-test-${Date.now()}`);

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("creates project structure", async () => {
    await initProject("test-project", testDir);

    const pkg = JSON.parse(await readFile(join(testDir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("test-project");
    expect(pkg.dependencies["@oni.bot/core"]).toBeDefined();

    const tsconfig = JSON.parse(await readFile(join(testDir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.target).toBe("ES2022");

    const entry = await readFile(join(testDir, "src", "index.ts"), "utf-8");
    expect(entry).toContain("StateGraph");
    expect(entry).toContain("@oni.bot/core");

    const test = await readFile(join(testDir, "src", "agent.test.ts"), "utf-8");
    expect(test).toContain("createTestHarness");
  });
});
