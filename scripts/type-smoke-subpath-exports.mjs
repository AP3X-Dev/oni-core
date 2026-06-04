#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const tmpDir = resolve(root, ".tmp-type-smoke");
const sourcePath = resolve(tmpDir, "index.ts");
const tsconfigPath = resolve(tmpDir, "tsconfig.json");
const failures = [];

function targetOf(entry, field) {
  if (typeof entry === "string") return field === "import" ? entry : undefined;
  if (entry && typeof entry === "object") return entry[field];
  return undefined;
}

function specifierFor(subpath) {
  return subpath === "." ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, "")}`;
}

if (!pkg.name) {
  failures.push("package.json is missing a package name");
}

const exportsEntries = Object.entries(pkg.exports ?? {});
for (const [subpath, entry] of exportsEntries) {
  const typesTarget = targetOf(entry, "types");
  if (!typesTarget) {
    failures.push(`${subpath}: missing types target`);
    continue;
  }

  const typesPath = resolve(root, typesTarget);
  if (!existsSync(typesPath)) {
    failures.push(`${subpath}: missing built types file ${typesTarget}`);
  }
}

if (failures.length > 0) {
  console.error("[type-smoke-subpath-exports] failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });

const imports = exportsEntries
  .map(([subpath], index) => `import type * as Export${index} from "${specifierFor(subpath)}";`)
  .join("\n");
const tuple = exportsEntries.map((_, index) => `typeof Export${index}`).join(",\n  ");
const source = `${imports}

type PublicExportModules = [
  ${tuple}
];

export type PublicApiTypeSmoke = PublicExportModules;
`;

const tsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    forceConsistentCasingInFileNames: true,
    types: ["node"],
  },
  files: [sourcePath],
};

await writeFile(sourcePath, source, "utf8");
await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");

const tscBin = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.CMD" : "tsc");
const result = spawnSync(tscBin, ["--noEmit", "-p", tsconfigPath], {
  cwd: root,
  shell: process.platform === "win32",
  stdio: "inherit",
});

await rm(tmpDir, { recursive: true, force: true });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[type-smoke-subpath-exports] ${exportsEntries.length} export subpaths typechecked.`);
