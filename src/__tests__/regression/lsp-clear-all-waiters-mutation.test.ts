/**
 * Regression test for BUG-6:
 * LSPClient.clearAllWaiters() live-array mutation during for...of
 * leaves diagnostics waiter Promises permanently unsettled.
 *
 * Root cause: w.resolve() inside clearAllWaiters() synchronously calls
 * removeWaiter() → waiters.splice(), shrinking the live array while the
 * for...of iterator advances by internal index. With N waiters, ~floor(N/2)
 * are skipped (w1, w3, w5, …) and their Promises never settle.
 *
 * Fix: snapshot with [...waiters] before iterating, matching the
 * BackgroundAgentPlatform.notifyWaiters() pattern in src/platform/in-memory.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { LSPClient } from "../../lsp/client.js";
import type { LSPServerConfig } from "../../lsp/types.js";

// node:fs is mocked because LSPClient imports readFileSync at the module level.
vi.mock("node:fs", () => ({
  readFileSync: () => "source-code",
}));

const config: LSPServerConfig = {
  id: "test-server",
  extensions: [".ts"],
  command: "echo",
  args: ["test"],
  languageId: "typescript",
};

// Internal surface exposed via the same `any` escape hatch used in
// lsp-client-coverage.test.ts and lsp-client-message-validation.test.ts.
type Internal = {
  waitForDiagnostics: (filePath: string) => Promise<void>;
  diagnosticsWaiters: Map<string, unknown[]>;
  clearAllWaiters: () => void;
  state: string;
};

function makeClient(): LSPClient & Internal {
  return new LSPClient(config, "/tmp/test") as unknown as LSPClient & Internal;
}

describe("clearAllWaiters — live-array mutation regression (BUG-6)", () => {
  it("settles ALL waiters for the same filePath when two are registered (w1 must not hang)", async () => {
    const client = makeClient();
    const filePath = "/tmp/test/bug6.ts";

    // Register two concurrent waiters for the same path — simulates two
    // concurrent touchFile(path, true) calls before any diagnostics arrive.
    // We use Promise.race with a hard timeout to detect a hung promise.
    const TIMEOUT_MS = 500;

    const settled: number[] = [];

    const p0 = client.waitForDiagnostics(filePath).then(() => {
      settled.push(0);
    });
    const p1 = client.waitForDiagnostics(filePath).then(() => {
      settled.push(1);
    });

    // Confirm both waiters are registered in the live array.
    expect(client.diagnosticsWaiters.get(filePath)).toHaveLength(2);

    // clearAllWaiters() is what stop() calls. Without the fix, the for...of
    // iterates the live array; w0.resolve() calls removeWaiter → splice(0,1),
    // shrinking [w0,w1] to [w1]. The iterator advances to index 1, but
    // waiters[1] is now undefined (length 1). w1.resolve() is never called,
    // so p1 hangs forever.
    client.clearAllWaiters();

    // Race each promise against a timeout. If either hangs, we'll see it.
    const timeoutSignal = (label: string) =>
      new Promise<string>((resolve) =>
        setTimeout(() => resolve(`HUNG:${label}`), TIMEOUT_MS),
      );

    const r0 = await Promise.race([p0.then(() => "settled:0"), timeoutSignal("p0")]);
    const r1 = await Promise.race([p1.then(() => "settled:1"), timeoutSignal("p1")]);

    // Both must settle — this is what the bug breaks for w1.
    expect(r0).toBe("settled:0");
    expect(r1).toBe("settled:1"); // FAILS against unfixed code (HUNG:p1)
    expect(settled).toContain(0);
    expect(settled).toContain(1);
  });

  it("settles ALL waiters with N=4 (w1, w3 skipped without fix)", async () => {
    const client = makeClient();
    const filePath = "/tmp/test/bug6-n4.ts";
    const TIMEOUT_MS = 500;

    const settled: number[] = [];
    const promises = [0, 1, 2, 3].map((i) =>
      client.waitForDiagnostics(filePath).then(() => {
        settled.push(i);
      }),
    );

    expect(client.diagnosticsWaiters.get(filePath)).toHaveLength(4);

    client.clearAllWaiters();

    const results = await Promise.all(
      promises.map((p, i) =>
        Promise.race([
          p.then(() => `settled:${i}`),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve(`HUNG:${i}`), TIMEOUT_MS),
          ),
        ]),
      ),
    );

    // Without the fix: w1 and w3 are skipped → ["settled:0","HUNG:1","settled:2","HUNG:3"]
    // With the fix: all 4 settle.
    expect(results).toEqual(["settled:0", "settled:1", "settled:2", "settled:3"]);
    expect(settled.sort()).toEqual([0, 1, 2, 3]);
  });
});
