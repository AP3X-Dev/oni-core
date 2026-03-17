// ============================================================
// @oni.bot/core CLI — test command
// Runs vitest with ONI-friendly defaults
// ============================================================

import { spawn } from "node:child_process";
import type { ParsedArgs } from "./router.js";

export async function testCommand(args: ParsedArgs): Promise<void> {
  const pattern = args.positional[0];
  const watch = args.flags.watch === "true" || args.flags.w === "true";

  const vitestArgs = [watch ? "" : "run"].filter(Boolean);

  if (pattern) {
    vitestArgs.push(pattern);
  }

  if (args.flags.verbose === "true") {
    vitestArgs.push("--reporter=verbose");
  }

  console.log(`\n  Running tests${pattern ? ` matching: ${pattern}` : ""}${watch ? " (watch mode)" : ""}\n`);

  const child = spawn("npx", ["vitest", ...vitestArgs], {
    stdio: "inherit",
  });

  return new Promise((resolvePromise) => {
    child.on("close", (code) => {
      if (code && code !== 0) process.exitCode = code;
      resolvePromise();
    });

    child.on("error", (err) => {
      console.error(`  Error: ${err.message}`);
      process.exitCode = 1;
      resolvePromise();
    });
  });
}
