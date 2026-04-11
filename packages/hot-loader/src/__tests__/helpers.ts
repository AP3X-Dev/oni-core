import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "oni-hot-loader-test-"));
}

export function cleanTempDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

export function writeExtension(dir: string, name: string, content: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

export function removeExtension(filePath: string): void {
  try { unlinkSync(filePath); } catch { /* ignore */ }
}

/** Wait for a condition to be true, polling every `interval` ms up to `timeout` ms. */
export async function waitFor(
  condition: () => boolean,
  timeout = 3000,
  interval = 25
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  if (!condition()) {
    throw new Error(`waitFor timed out after ${timeout}ms`);
  }
}

/**
 * Creates a mock registry matching the ToolRegistry interface
 * used by the hot-loader.
 */
export function createMockRegistry() {
  const tools = new Map<string, { handler: Function; opts: Record<string, unknown> }>();

  return {
    register(name: string, handler: Function, opts: Record<string, unknown> = {}) {
      tools.set(name, { handler, opts });
      return this;
    },
    unregister(name: string): boolean {
      return tools.delete(name);
    },
    list(): string[] {
      return [...tools.keys()];
    },
    has(name: string): boolean {
      return tools.has(name);
    },
    _tools: tools,
  };
}
