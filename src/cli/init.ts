// ============================================================
// @oni.bot/core CLI — init command
// ============================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { templates } from "./templates.js";
import type { ParsedArgs } from "./router.js";

export async function initProject(name: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await mkdir(join(targetDir, "src"), { recursive: true });

  // Write files
  await writeFile(join(targetDir, "package.json"), templates.packageJson(name));
  await writeFile(join(targetDir, "tsconfig.json"), templates.tsconfig());
  await writeFile(join(targetDir, "src", "index.ts"), templates.entrypoint());
  await writeFile(join(targetDir, "src", "agent.test.ts"), templates.test());
  await writeFile(join(targetDir, "src", "harness-agent.ts"), templates.harnessAgent());
  await writeFile(join(targetDir, ".gitignore"), templates.gitignore());
}

export async function initCommand(args: ParsedArgs): Promise<void> {
  const projectName = args.positional[0];
  if (!projectName) {
    console.error("  Error: project name required\n  Usage: oni init <name>");
    process.exitCode = 1;
    return;
  }

  const name = basename(projectName);
  const targetDir = resolve(process.cwd(), projectName);

  console.log(`\n  Creating ONI project: ${name}\n`);
  await initProject(name, targetDir);
  console.log(`  Done! Next steps:\n`);
  console.log(`    cd ${name}`);
  console.log(`    npm install`);
  console.log(`    npx tsx src/index.ts\n`);
}
