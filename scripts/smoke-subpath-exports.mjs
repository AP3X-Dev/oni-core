#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const failures = [];

function targetOf(entry, field) {
  if (typeof entry === "string") return field === "import" ? entry : undefined;
  if (entry && typeof entry === "object") return entry[field];
  return undefined;
}

for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  const importTarget = targetOf(entry, "import");
  const typesTarget = targetOf(entry, "types");

  if (!importTarget) {
    failures.push(`${subpath}: missing import target`);
    continue;
  }

  const importPath = resolve(root, importTarget);
  if (!existsSync(importPath)) {
    failures.push(`${subpath}: missing built import file ${importTarget}`);
    continue;
  }

  if (typesTarget) {
    const typesPath = resolve(root, typesTarget);
    if (!existsSync(typesPath)) {
      failures.push(`${subpath}: missing built types file ${typesTarget}`);
    }
  }

  try {
    await import(pathToFileURL(importPath).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${subpath}: import failed for ${importTarget}: ${message}`);
  }
}

if (failures.length > 0) {
  console.error("[smoke-subpath-exports] failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[smoke-subpath-exports] ${Object.keys(pkg.exports ?? {}).length} export subpaths imported.`);
}
