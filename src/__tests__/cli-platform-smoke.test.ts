import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  platformSmokeCommand,
  runPlatformSmoke,
} from "../cli/platform-smoke.js";
import {
  JsonFileAgentSessionStore,
  JsonFileArtifactStore,
} from "../platform/index.js";

describe("platform-smoke CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the local platform path and persists session and artifact records", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-cli-platform-smoke-"));
    const result = await runPlatformSmoke({
      rootDir: root,
      actor: "test-runner",
      flags: { dir: root },
    });

    const sessions = new JsonFileAgentSessionStore(result.sessionFile);
    const artifacts = new JsonFileArtifactStore(result.artifactFile);

    await expect(sessions.get(result.session.id)).resolves.toMatchObject({
      id: result.session.id,
      status: "completed",
      trigger: {
        kind: "manual",
        source: "oni-cli",
        actor: "test-runner",
      },
    });
    await expect(artifacts.list(result.session.id)).resolves.toEqual([
      expect.objectContaining({
        type: "report",
        title: "External agent artifact",
        content: expect.stringContaining("Platform smoke completed."),
      }),
    ]);
  });

  it("prints a JSON summary without setting a failure exit code", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-cli-platform-smoke-command-"));
    const logs: string[] = [];
    const originalExitCode = process.exitCode as number | string | undefined;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    try {
      await platformSmokeCommand({
        command: "platform-smoke",
        positional: [],
        flags: { dir: root, json: "true" },
      });

      const summary = JSON.parse(logs.join("\n")) as Record<string, unknown>;
      expect(process.exitCode).toBeUndefined();
      expect(summary.status).toBe("completed");
      expect(summary.artifactCount).toBe(1);
      expect(summary.sessionFile).toBe(join(root, "state", "sessions.json"));
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
