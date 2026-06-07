#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const packagesDir = resolve(root, "packages");
const failures = [];

const DISALLOWED_PATHS = [
  { pattern: /(^|\/)__tests__(\/|$)/, reason: "test directory" },
  { pattern: /(^|\/)(src|coverage|node_modules|scripts|\.github|\.tmp[^/]*)(\/|$)/, reason: "source/local directory" },
  { pattern: /(^|\/)(CLAUDE|AGENTS|GEMINI|HARDENING_HANDOFF|OPERATIONS_RUNBOOK|PACKAGE_RELEASE_POLICY|PRODUCTION_HARDENING_PLAN|PROJECT_CONTEXT|RESEARCH_SPEC|CONTRIBUTING)\.md$/i, reason: "internal planning doc" },
  { pattern: /\.(test|spec)\.[cm]?[jt]sx?$/i, reason: "compiled test file" },
  { pattern: /\.(env|pem|key|p12|pfx)$/i, reason: "secret-like file" },
  { pattern: /(^|\/)(credentials|serviceAccount|service-account)[^/]*\.json$/i, reason: "credential file" },
  { pattern: /\.tsbuildinfo$/i, reason: "typescript build cache" },
];

const ROOT_TOP_LEVEL = new Set([
  "assets",
  "CHANGELOG.md",
  "GUIDE.md",
  "README.md",
  "SECURITY.md",
  "dist",
  "package.json",
]);

const PACKAGE_TOP_LEVEL = new Set([
  "CHANGELOG.md",
  "LICENSE",
  "LICENSE.md",
  "README.md",
  "dist",
  "package.json",
]);

function npmCommand() {
  return process.platform === "win32" ? "npm.CMD" : "npm";
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function packagePath(path) {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
}

function collectExportTargets(entry, targets = []) {
  if (typeof entry === "string") {
    targets.push(entry);
    return targets;
  }
  if (!entry || typeof entry !== "object") return targets;
  for (const value of Object.values(entry)) {
    collectExportTargets(value, targets);
  }
  return targets;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validateTargetIncluded(pkg, files, dirLabel, field, target) {
  if (!target || !target.startsWith("./")) return;
  const normalized = packagePath(target);
  if (!files.has(normalized)) {
    failures.push(`${dirLabel}: ${field} target ${target} is missing from package tarball`);
  }
}

function runPack(dir, dirLabel) {
  const result = spawnSync(npmCommand(), ["pack", "--dry-run", "--json"], {
    cwd: dir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    failures.push(`${dirLabel}: npm pack failed: ${result.stderr.trim() || result.stdout.trim()}`);
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed[0] : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${dirLabel}: npm pack did not return JSON: ${message}`);
    return null;
  }
}

function validatePack(manifest, pack, dirLabel, allowedTopLevel, dir) {
  if (!pack || !Array.isArray(pack.files)) {
    failures.push(`${dirLabel}: npm pack JSON did not include a files array`);
    return;
  }

  const files = new Set(pack.files.map((file) => packagePath(file.path)));
  if (!files.has("package.json")) {
    failures.push(`${dirLabel}: package.json is missing from package tarball`);
  }
  if (![...files].some((file) => file.startsWith("dist/"))) {
    failures.push(`${dirLabel}: package tarball does not include built dist output`);
  }

  for (const file of files) {
    const topLevel = file.split("/")[0];
    if (!allowedTopLevel.has(topLevel)) {
      failures.push(`${dirLabel}: unexpected top-level package file ${file}`);
    }
    for (const rule of DISALLOWED_PATHS) {
      if (rule.pattern.test(file)) {
        failures.push(`${dirLabel}: ${file} includes ${rule.reason}`);
      }
    }
    if (file.endsWith(".map")) {
      const mapPath = resolve(dir, file);
      if (existsSync(mapPath) && /"sourcesContent"\s*:/.test(readFileSync(mapPath, "utf8"))) {
        failures.push(`${dirLabel}: ${file} embeds sourcesContent; ship external maps without source bodies`);
      }
    }
  }

  validateTargetIncluded(manifest, files, dirLabel, "main", manifest.main);
  validateTargetIncluded(manifest, files, dirLabel, "types", manifest.types);
  for (const target of collectExportTargets(manifest.exports ?? {})) {
    validateTargetIncluded(manifest, files, dirLabel, "exports", target);
  }

  const sourceMaps = [...files].filter((file) => file.endsWith(".map")).length;
  console.log(
    `[check-package-tarballs] ${manifest.name}: ${files.size} files, ${humanSize(pack.size ?? 0)} packed, ${sourceMaps} source maps.`,
  );
}

async function publishablePackages() {
  const packages = [{ dir: root, manifest: await readJson(resolve(root, "package.json")), allowedTopLevel: ROOT_TOP_LEVEL }];
  if (!existsSync(packagesDir)) return packages;

  const entries = await readdir(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(packagesDir, entry.name);
    const manifestPath = resolve(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = await readJson(manifestPath);
    if (manifest.private === true) continue;
    packages.push({ dir, manifest, allowedTopLevel: PACKAGE_TOP_LEVEL });
  }

  return packages;
}

for (const candidate of await publishablePackages()) {
  const label = candidate.manifest.name ?? candidate.dir;
  const pack = runPack(candidate.dir, label);
  validatePack(candidate.manifest, pack, label, candidate.allowedTopLevel, candidate.dir);
}

if (failures.length > 0) {
  console.error("[check-package-tarballs] failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[check-package-tarballs] all publishable package tarballs passed.");
