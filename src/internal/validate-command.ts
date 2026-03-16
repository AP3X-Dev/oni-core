/**
 * Command validation for subprocess spawning.
 *
 * Validates that a command string from user config (oni.jsonc, ~/.oni/config.jsonc)
 * is safe to pass to child_process.spawn(). Prevents command injection via
 * malicious config files committed to shared repositories.
 *
 * BUG-0156, BUG-0160: Config-sourced commands are untrusted input.
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve, normalize } from "node:path";
import { execFileSync } from "node:child_process";

/** Characters that indicate shell injection attempts even with shell: false */
const DANGEROUS_CHARS = /[;|&`$(){}[\]<>!#~]/;

/** Path traversal sequences */
const PATH_TRAVERSAL = /\.\.\//;

/**
 * Validate a command string before passing it to spawn().
 *
 * Throws if the command is suspicious or dangerous. This is intentionally
 * strict — a blocked legitimate command can be allowlisted, but a passed
 * malicious command is a security breach.
 */
export function validateSpawnCommand(command: string, context: string): void {
  if (!command || typeof command !== "string") {
    throw new Error(`${context}: command is empty or not a string`);
  }

  const trimmed = command.trim();

  // Reject shell metacharacters — even with shell: false, some of these
  // can be meaningful in certain spawn implementations
  if (DANGEROUS_CHARS.test(trimmed)) {
    throw new Error(
      `${context}: command contains dangerous characters: "${trimmed}". ` +
      `Only simple binary names or absolute paths are allowed.`,
    );
  }

  // Reject path traversal
  if (PATH_TRAVERSAL.test(trimmed)) {
    throw new Error(
      `${context}: command contains path traversal: "${trimmed}". ` +
      `Use an absolute path or a binary name on PATH.`,
    );
  }

  // If it's an absolute path, verify the binary exists
  if (isAbsolute(trimmed)) {
    const normalized = normalize(resolve(trimmed));
    if (!existsSync(normalized)) {
      throw new Error(`${context}: command not found: "${normalized}"`);
    }
    return;
  }

  // For bare command names (e.g., "typescript-language-server"), verify
  // the binary exists on PATH using `which`
  try {
    execFileSync("which", [trimmed], { stdio: "pipe", timeout: 3000 });
  } catch {
    throw new Error(
      `${context}: command "${trimmed}" not found on PATH. ` +
      `Install it or use an absolute path.`,
    );
  }
}
