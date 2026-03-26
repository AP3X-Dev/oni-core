// ============================================================
// @oni.bot/core/harness — Shared Utilities
// ============================================================
// Zero-dependency helpers used across all harness primitives.
// ============================================================

import { randomUUID } from "node:crypto";
import {
  writeFileSync, renameSync, existsSync, unlinkSync,
  readFileSync, mkdirSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { dirname } from "node:path";

/**
 * Generates a stable random ID using crypto.randomUUID().
 */
export function randomId(): string {
  return randomUUID();
}

/**
 * Atomic JSON write: write to .tmp then rename.
 * Ensures the target file is never in a partially-written state.
 * Creates parent directories if they don't exist.
 */
export function atomicWriteJSON(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, filePath);
}

/**
 * Read and parse a JSON file. Returns null if file does not exist.
 */
export function readJSON<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

/**
 * Simple file-based lock with exponential backoff.
 * Prevents concurrent writes to the same file.
 */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const maxWaitMs = 5000;
  const baseDelayMs = 50;
  let waited = 0;

  while (existsSync(lockPath)) {
    if (waited >= maxWaitMs) {
      // Stale lock detection: if lock file is older than maxWaitMs, remove it
      try {
        unlinkSync(lockPath);
        break;
      } catch {
        throw new Error(`Lock timeout: ${lockPath} held for ${maxWaitMs}ms`);
      }
    }
    const delay = Math.min(baseDelayMs * 2 ** Math.floor(waited / baseDelayMs), 500);
    await new Promise(r => setTimeout(r, delay));
    waited += delay;
  }

  writeFileSync(lockPath, process.pid.toString(), "utf8");
  try {
    return await fn();
  } finally {
    if (existsSync(lockPath)) {
      try { unlinkSync(lockPath); } catch { /* lock already cleaned */ }
    }
  }
}

/**
 * Execute a git command, return stdout. Returns null if git unavailable or command fails.
 */
export function execGit(args: string, cwd: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if git is available in the current environment.
 */
export function isGitAvailable(): boolean {
  return execGit("--version", process.cwd()) !== null;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
