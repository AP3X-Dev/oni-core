// Regression test for BUG-7:
// SessionInit.withTimeout() timer was never cleared when the input promise
// resolved first, holding the Node event loop alive for up to smokeTestTimeoutMs.
//
// Load-bearing check: reverting the `.finally(() => clearTimeout(handle))` fix
// in SessionInit.ts causes `clearTimeout` to NOT be called with the timer handle,
// so `clearedHandles` will not include the handle returned by `setTimeout`,
// and the assertion `expect(timerWasCleared).toBe(true)` fails.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSessionInit } from "../SessionInit.js";
import { SessionBridge } from "../SessionBridge.js";
import { FeatureRegistry } from "../FeatureRegistry.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "oni-si-timer-"));
}

async function makeResumeSession(bridgeDir: string): Promise<void> {
  const bridge = new SessionBridge(bridgeDir);
  await bridge.open();
  await bridge.close(
    { featuresAttempted: [], featuresPassed: [], featuresFailed: [], summary: "prior" },
    "notes",
  );
}

describe("SessionInit.withTimeout timer cleanup (BUG-7)", () => {
  let tmpDir: string;
  let bridgeDir: string;
  let registryPath: string;

  // Track every handle passed to clearTimeout during the test.
  const clearedHandles = new Set<ReturnType<typeof setTimeout>>();
  // Track every handle returned by setTimeout during the test.
  const createdHandles = new Set<ReturnType<typeof setTimeout>>();

  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;
  let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    bridgeDir = join(tmpDir, "sessions");
    registryPath = join(tmpDir, "features.json");

    clearedHandles.clear();
    createdHandles.clear();

    // Spy on the real setTimeout / clearTimeout so we can track handle lifecycle
    // without disrupting actual timer behaviour (smoke tests must still resolve).
    setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        const handle = (globalThis as typeof globalThis & { _realSetTimeout: typeof setTimeout })
          ._realSetTimeout
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?? (globalThis as any).__vitest_worker__?.rpc?.setTimeout
          // fall through to the global (already unpatched via a capture below)
          ?? realSetTimeout;
        const id = handle(fn as TimerHandler, ms, ...args) as ReturnType<typeof setTimeout>;
        createdHandles.add(id);
        return id;
      },
    );

    clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(
      (id?: ReturnType<typeof setTimeout>) => {
        if (id !== undefined) clearedHandles.add(id);
        realClearTimeout(id);
      },
    );
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("clears the timeout timer when smoke test resolves before the deadline (single call)", async () => {
    await makeResumeSession(bridgeDir);

    const bridge = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);

    const result = await runSessionInit({
      bridge,
      registry,
      smokeTest: async () => true,
      smokeTestTimeoutMs: 30_000,
    });

    expect(result.environmentHealthy).toBe(true);

    // Every timer that withTimeout created must have been cleared.
    // Without the fix: createdHandles contains the 30-s handle but
    // clearedHandles does NOT → timerWasCleared is false → test FAILS.
    for (const handle of createdHandles) {
      expect(clearedHandles.has(handle)).toBe(true);
    }
  });

  it("clears BOTH timeout timers when fixer re-test path fires (two withTimeout calls)", async () => {
    await makeResumeSession(bridgeDir);

    const bridge = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);

    let call = 0;
    const result = await runSessionInit({
      bridge,
      registry,
      smokeTest: async () => {
        call++;
        return call > 1; // first call → false (triggers fixer), second → true
      },
      smokeTestTimeoutMs: 30_000,
      onBrokenEnvironment: "fix",
      environmentFixer: async () => { /* no-op */ },
    });

    expect(result.environmentHealthy).toBe(true);

    // Both handles must have been cleared (two withTimeout invocations).
    for (const handle of createdHandles) {
      expect(clearedHandles.has(handle)).toBe(true);
    }
  });
});

// ── Capture real implementations BEFORE any mock runs ──────────────────────
// These are module-level constants evaluated at import time, before beforeEach
// patches globalThis.setTimeout / globalThis.clearTimeout.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
