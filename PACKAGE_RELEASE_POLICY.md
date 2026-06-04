# Package Release Policy

This repository publishes `@oni.bot/core` plus publishable workspace extension
packages. Release gates must protect both API shape and package contents.

## Public API Gates

- `pnpm run coverage:quality` runs the root coverage suite with blocking
  global and module-specific thresholds for platform, external-agent, MCP/LSP,
  prebuilt, tool, GitHub, and auth-resolver surfaces.
- `pnpm run smoke:exports` imports every built root `package.json` export
  subpath.
- `pnpm run typecheck:exports` compiles package-name TypeScript imports for
  every public root export subpath against generated declaration files.
- New public exports must be added to the relevant module index, root
  `package.json` exports when appropriate, README/GUIDE examples, and the
  export smoke checks.

## Tarball Contents

`pnpm run pack:snapshot` runs `npm pack --dry-run --json` for the root package
and every non-private workspace package. It fails if a tarball:

- omits package entrypoints referenced by `main`, `types`, or `exports`;
- includes source directories, tests, coverage, local scripts, planning docs, or
  local temp directories;
- includes secret-like files such as `.env`, `.pem`, `.key`, `.p12`, `.pfx`, or
  credential JSON files;
- includes TypeScript build cache files.

The root package may ship only `dist`, `package.json`, `README.md`,
`CHANGELOG.md`, `GUIDE.md`, and `SECURITY.md`. Workspace packages may ship only
`dist`, `package.json`, and standard package docs such as README, CHANGELOG, or
LICENSE files.

## Source Maps

Decision: ship external `.js.map` and `.d.ts.map` files.

Reason: ONI is a developer/runtime package, and external source maps materially
improve stack trace debugging, generated declaration navigation, and downstream
incident triage. The maps do not embed `sourcesContent`, so the tarball exposes
source file paths and mappings without bundling source bodies outside the built
package output.

Guardrail: `pnpm run pack:snapshot` counts shipped source maps and fails if any
map embeds `sourcesContent`. If future releases need a private/proprietary
distribution mode, change this policy and the checker in the same patch.

## Release Command

```powershell
pnpm run verify:release
git diff --check
```
