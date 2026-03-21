// ============================================================
// @oni.bot/core CLI — run command
// Executes an agent or swarm file via tsx
// ============================================================

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ParsedArgs } from "./router.js";

export function resolveEntryFile(file: string): string {
  if (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".mts") || file.endsWith(".mjs")) {
    return file;
  }
  return `${file}.ts`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export async function runCommand(args: ParsedArgs): Promise<void> {
  const file = args.positional[0];
  if (!file) {
    console.error("  Error: file required\n  Usage: oni run <file>");
    process.exitCode = 1;
    return;
  }

  const entryFile = resolve(process.cwd(), resolveEntryFile(file));

  console.log(`\n  Running: ${entryFile}`);
  const startTime = Date.now();

  // Spawn tsx to run the file
  const child = spawn("npx", ["tsx", entryFile], {
    stdio: "inherit",
    env: { ...process.env },
  });

  return new Promise((resolvePromise) => {
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      const duration = formatDuration(Date.now() - startTime);
      console.log(`\n  Completed in ${duration} (exit code: ${exitCode})`);
      if (exitCode !== 0) process.exitCode = exitCode;
      resolvePromise();
    });

    child.on("error", (err) => {
      console.error(`  Error: ${err.message}`);
      process.exitCode = 1;
      resolvePromise();
    });
  });
}
