// ============================================================
// @oni.bot/core/harness — Shared Utilities
// ============================================================
// Zero-dependency helpers used across all harness primitives.
// ============================================================

import { randomUUID } from "node:crypto";
import {
  writeFileSync, renameSync, existsSync, unlinkSync,
  readFileSync, mkdirSync, openSync, closeSync, statSync,
  constants as fsConstants,
} from "node:fs";
import { execFileSync } from "node:child_process";
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
 * File-based lock using atomic exclusive-create (O_CREAT | O_EXCL via 'wx' flag).
 * Two concurrent callers cannot both succeed — the OS guarantees only one
 * `open(..., O_EXCL)` wins on the same path.
 *
 * Stale lock detection uses file mtime: if the lock file is older than
 * `staleLockMs`, it is assumed to be from a crashed process and removed.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  staleLockMs = 30_000,
): Promise<T> {
  const maxWaitMs = 10_000;
  const baseDelayMs = 50;
  let waited = 0;

  while (true) {
    try {
      // Atomic lock acquisition: O_CREAT | O_EXCL — fails if file exists
      const fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
      // Write PID for diagnostics
      const buf = Buffer.from(process.pid.toString(), "utf8");
      writeFileSync(fd, buf);
      closeSync(fd);
      break;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err; // Unexpected error — propagate

      // Lock file exists — check if it's stale
      try {
        const stat = statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > staleLockMs) {
          // Stale lock from a crashed process — remove and retry
          try { unlinkSync(lockPath); } catch { /* another process cleaned it */ }
          continue;
        }
      } catch {
        // Lock was just released between our open attempt and stat — retry
        continue;
      }

      if (waited >= maxWaitMs) {
        throw new Error(
          `Lock timeout: ${lockPath} held for ${maxWaitMs}ms. ` +
          `If the holding process crashed, the lock will auto-clear after ${staleLockMs}ms.`,
        );
      }

      const delay = Math.min(baseDelayMs * 2 ** Math.floor(waited / baseDelayMs), 500);
      await new Promise(r => setTimeout(r, delay));
      waited += delay;
    }
  }

  try {
    return await fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* lock already cleaned */ }
  }
}

/**
 * Execute a git command safely using execFileSync with argument arrays.
 * Never passes through a shell — immune to shell injection.
 *
 * Returns stdout on success, null only if git binary is not found (ENOENT).
 * Throws on all other failures (bad args, git errors) so callers can
 * distinguish "git not installed" from "git command failed".
 */
export function execGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    }).trim();
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT = git binary not found — expected in some environments
    if (code === "ENOENT") return null;
    // All other errors (bad args, merge conflicts, etc.) should propagate
    throw err;
  }
}

/**
 * Check if git is available in the current environment.
 */
export function isGitAvailable(): boolean {
  try {
    execGit(["--version"], process.cwd());
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Sanitize text before injecting into agent prompts.
 * Strips patterns that could manipulate agent behavior when
 * reinjected from untrusted stored artifacts.
 */
export function sanitizeForPrompt(text: string): string {
  return text
    // Strip common prompt injection delimiters
    .replace(/<\/?system[^>]*>/gi, "")
    .replace(/<\/?user[^>]*>/gi, "")
    .replace(/<\/?assistant[^>]*>/gi, "")
    .replace(/<\/?human[^>]*>/gi, "")
    // Strip CDATA-style injections
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    // Strip XML-style processing instructions
    .replace(/<\?[\s\S]*?\?>/g, "")
    // Collapse excessive whitespace that could hide content
    .replace(/\n{4,}/g, "\n\n\n");
}
