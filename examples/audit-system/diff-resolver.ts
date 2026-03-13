import { execSync } from "node:child_process";
import { extname } from "node:path";
import type { DiffResult } from "./types.js";

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".h", ".hpp", ".cs",
  ".json", ".yaml", ".yml", ".toml",
]);

export function parseDiffOutput(output: string, extensions?: string[]): string[] {
  const extFilter = extensions ? new Set(extensions) : SOURCE_EXTENSIONS;
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && extFilter.has(extname(l)));
}

export async function resolveFiles(opts: {
  mode: "diff" | "full";
  targetDir: string;
  baseBranch: string;
}): Promise<DiffResult> {
  if (opts.mode === "full") {
    return { files: [], mode: "full" };
  }

  try {
    const output = execSync(
      `git diff --name-only ${opts.baseBranch}...HEAD`,
      { cwd: opts.targetDir, encoding: "utf-8", timeout: 10_000 },
    );
    const files = parseDiffOutput(output);
    return { files, mode: "diff", baseBranch: opts.baseBranch };
  } catch {
    // Not a git repo or no diff — fall back to full scan
    return { files: [], mode: "full" };
  }
}
