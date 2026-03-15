// ============================================================
// @oni.bot/core/harness/memory — fs-compat
//
// Lazy fs/path helpers for browser compatibility.
// Single source of truth — all modules that need fs must import
// from here, NOT use top-level import * as fs from 'node:fs'.
// ============================================================

export function getFs(): typeof import("fs") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("fs") as typeof import("fs");
  } catch {
    return null;
  }
}

export function getPath(): typeof import("path") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("path") as typeof import("path");
  } catch {
    return null;
  }
}
