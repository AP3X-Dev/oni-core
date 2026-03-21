// ============================================================
// @oni.bot/core CLI — dev command
// Hot-reload dev server using tsx --watch
// ============================================================

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ParsedArgs } from "./router.js";

export function resolveDevFile(file: string | undefined): string {
  return file ?? "src/index.ts";
}

export function formatRestart(count: number): string {
  return `  [oni dev] Restart #${count}`;
}

export async function devCommand(args: ParsedArgs): Promise<void> {
  const file = resolveDevFile(args.positional[0]);
  const entryFile = resolve(process.cwd(), file);

  // BUG-0417: Ensure entry file is within the project directory
  const cwd = process.cwd();
  if (!entryFile.startsWith(cwd + "/") && entryFile !== cwd) {
    console.error("  Error: entry file must be within the project directory");
    process.exitCode = 1;
    return;
  }

  const port = args.flags.port ?? "4100";

  console.log(`\n  ONI Dev Server`);
  console.log(`  Watching: ${entryFile}`);
  console.log(`  Port: ${port}`);
  console.log(`  Press Ctrl+C to stop\n`);

  // Check if @oni.bot/studio is installed
  try {
    // @ts-expect-error — @oni.bot/studio is an optional peer dependency
    await import("@oni.bot/studio");
    console.log(`  ONI Studio available at http://localhost:${port}\n`);
  } catch {
    // Studio not installed, that's fine
    console.log(`  Tip: Install @oni.bot/studio for visual debugging\n`);
  }

  // Use tsx --watch for hot-reload
  const child = spawn("npx", ["tsx", "watch", entryFile], {
    stdio: "inherit",
    env: { ...process.env, ONI_DEV: "true", ONI_PORT: port },
  });

  // Handle graceful shutdown
  const cleanup = () => {
    child.kill("SIGTERM");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return new Promise((resolvePromise) => {
    child.on("close", (code) => {
      process.off("SIGINT", cleanup);
      process.off("SIGTERM", cleanup);
      if (code && code !== 0) process.exitCode = code;
      resolvePromise();
    });
  });
}
