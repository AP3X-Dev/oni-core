// ============================================================
// @oni.bot/core CLI — build command
// TypeScript build + export validation
// ============================================================

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ParsedArgs } from "./router.js";

interface PackageExports {
  exports?: Record<string, { import?: string; types?: string } | string>;
}

export function validateExports(pkg: PackageExports): string[] {
  const errors: string[] = [];
  if (!pkg.exports) return errors;

  for (const [path, value] of Object.entries(pkg.exports)) {
    if (typeof value === "string") continue;
    if (!value.types) {
      errors.push(`Export "${path}" is missing "types" field`);
    }
    if (!value.import) {
      errors.push(`Export "${path}" is missing "import" field`);
    }
  }

  return errors;
}

export async function buildCommand(args: ParsedArgs): Promise<void> {
  const noCheck = args.flags["no-check"] === "true";
  const cwd = process.cwd();

  console.log("\n  Building...\n");

  // Step 1: Run tsc
  const tscArgs = noCheck ? ["tsc", "--noCheck"] : ["tsc"];

  const child = spawn("npx", tscArgs, {
    stdio: "inherit",
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", (err) => {
      reject(new Error(`Failed to spawn npx: ${err.message}`));
    });
    child.on("close", resolve);
  }).catch((err: Error) => {
    console.error(`\n  ${err.message}`);
    process.exitCode = 1;
    return 1;
  });

  if (exitCode !== 0) {
    console.error("\n  Build failed — TypeScript compilation errors");
    process.exitCode = exitCode ?? 1;
    return;
  }

  console.log("  TypeScript compilation successful");

  // Step 2: Validate package.json exports
  try {
    const pkgPath = resolve(cwd, "package.json");
    const pkgJson = JSON.parse(await readFile(pkgPath, "utf-8")) as PackageExports;
    const errors = validateExports(pkgJson);

    if (errors.length > 0) {
      console.log("\n  Export validation warnings:");
      for (const err of errors) {
        console.log(`    ! ${err}`);
      }
    } else {
      console.log("  Export validation passed");
    }
  } catch {
    // No package.json or can't read — skip validation
  }

  console.log("\n  Build complete!\n");
}
