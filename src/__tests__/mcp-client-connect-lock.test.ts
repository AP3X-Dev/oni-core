/**
 * BUG-0427: MCPClient.connect() returned early when state === "ready" without
 * checking _connectLock, so a concurrent connect/disconnect/connect sequence
 * could spawn two StdioTransport instances, leaking one child process.
 *
 * Fix: the lock check now precedes the state check so concurrent callers
 * coalesce onto the in-flight promise.
 */

import { describe, it, expect, vi } from "vitest";
import { MCPClient } from "../mcp/client.js";
import type { MCPServerConfig } from "../mcp/types.js";

const TEST_CONFIG: MCPServerConfig = {
  name: "test",
  transport: "stdio",
  command: "node",
  args: [],
};

/** Patch _runConnect on a client instance to avoid real process spawns. */
function patchRunConnect(
  client: MCPClient,
  impl: () => Promise<void>,
): void {
  (client as any)._runConnect = impl;
}

describe("MCPClient connect lock (BUG-0427)", () => {
  it("concurrent connect() calls coalesce onto a single _runConnect invocation", async () => {
    const client = new MCPClient(TEST_CONFIG);
    let runCount = 0;

    let resolveRun!: () => void;
    const runStarted = new Promise<void>((r) => { resolveRun = r; });
    let runBlocker: () => void;
    const runBlock = new Promise<void>((r) => { runBlocker = r; });

    patchRunConnect(client, async () => {
      runCount++;
      resolveRun();
      await runBlock;
      // Simulate successful connect
      (client as any).state = "ready";
    });

    // Fire two concurrent connect() calls before the first one resolves
    const p1 = client.connect();
    await runStarted; // first call is in-flight
    const p2 = client.connect(); // second call while lock is held

    // Unblock the in-flight _runConnect
    runBlocker!();
    await Promise.all([p1, p2]);

    // _runConnect must have been called exactly once
    expect(runCount).toBe(1);
  });

  it("connect() on already-ready client skips _runConnect entirely", async () => {
    const client = new MCPClient(TEST_CONFIG);
    let runCount = 0;

    patchRunConnect(client, async () => {
      runCount++;
      (client as any).state = "ready";
    });

    await client.connect();
    expect(runCount).toBe(1);

    // Second connect — state is "ready", no lock in flight
    await client.connect();

    // _runConnect should not have been called a second time
    expect(runCount).toBe(1);
  });

  it("connect() while lock is held returns the same promise without spawning again", async () => {
    const client = new MCPClient(TEST_CONFIG);
    let runCount = 0;
    let unblock!: () => void;
    const blocker = new Promise<void>((r) => { unblock = r; });

    patchRunConnect(client, async () => {
      runCount++;
      await blocker;
      (client as any).state = "ready";
    });

    const p1 = client.connect();
    const p2 = client.connect();
    const p3 = client.connect();

    unblock();
    await Promise.all([p1, p2, p3]);

    expect(runCount).toBe(1);
  });
});
