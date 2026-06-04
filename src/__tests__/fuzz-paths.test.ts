// ============================================================
// Property-based (fuzz) tests for runtime path-scope normalization.
// ============================================================
// Target: src/platform/policy.ts
//   - createRuntimePolicyFromParts
//   - policy.assertPathAllowed
//
// Invariants under fuzzing of hostile path inputs (".." traversal,
// absolute paths, odd separators, embedded null-ish junk):
//   1. "no escape": any path returned by assertPathAllowed is ALWAYS
//      inside the real workspace root.
//   2. "no crash other than PlatformPolicyError": assertPathAllowed may
//      reject input, but only ever by throwing PlatformPolicyError -- it
//      must never throw a different error type and must never return an
//      out-of-bounds path.
// ============================================================

import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { CapabilityGrant, TaskSpec } from "../platform/index.js";
import {
  PlatformPolicyError,
  createRuntimePolicyFromParts,
} from "../platform/index.js";

// Mirror of the production test's TaskSpec/grant builders, trimmed to the
// fields the policy actually consumes for path checks.
function task(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    title: "Fuzz path scope normalization",
    goal: "Ensure path scope never escapes the workspace.",
    scope: {
      network: "none",
    },
    successCriteria: ["The policy never returns a path outside the workspace."],
    allowedActions: ["read", "write"],
    ...overrides,
  };
}

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: "cap_fuzz",
    sessionId: "ses_fuzz",
    identityId: "idn_fuzz",
    status: "active",
    issuedAt: "2026-06-04T00:00:00.000Z",
    capabilities: [],
    ...overrides,
  };
}

// Returns true when `child` is the same as, or nested under, `parent`.
// Matches the policy's own isInsidePath semantics.
function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

let workspaceDir: string;
let realWorkspaceRoot: string;

beforeAll(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "oni-fuzz-paths-"));
  // Seed a couple of real nested dirs so the deepest-existing walk has
  // genuine filesystem state to resolve against (not just synthetic tails).
  mkdirSync(join(workspaceDir, "src", "nested", "deep"), { recursive: true });
  mkdirSync(join(workspaceDir, "data"), { recursive: true });
  // On Windows tmpdir is often an 8.3 short name / junction; the policy
  // realpath-resolves everything, so we compare against the resolved root.
  realWorkspaceRoot = realpathSync(workspaceDir);
});

afterAll(() => {
  if (workspaceDir) {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// Arbitrary single path segment: a grab-bag of benign names, traversal
// tokens, separator junk, and absolute-path fragments.
const segment = fc.oneof(
  fc.constantFrom(
    "..",
    "...",
    ".",
    "",
    "src",
    "nested",
    "deep",
    "data",
    "a",
    "b",
    "foo.ts",
    "..\\",
    "../",
    "..\\..",
    "../..",
    "%2e%2e",
    " ",
    "C:",
    "\\\\server",
  ),
  // Free-form strings can produce anything; keep them shortish so shrinking
  // stays fast but still exercises odd characters.
  fc.string({ minLength: 0, maxLength: 8 }),
);

// Build a path string out of generated segments joined with a randomly
// chosen separator style (forward, back, or mixed), optionally absolute.
const pathArb = fc
  .record({
    segments: fc.array(segment, { minLength: 0, maxLength: 6 }),
    sepStyle: fc.constantFrom("/", "\\", "mix"),
    absolutePrefix: fc.constantFrom("", "/", "\\", "C:\\", "C:/", "//", "\\\\"),
  })
  .map(({ segments, sepStyle, absolutePrefix }) => {
    const joined = segments
      .map((seg, i) => {
        if (sepStyle === "mix") return i % 2 === 0 ? `${seg}/` : `${seg}\\`;
        return seg;
      })
      .join(sepStyle === "mix" ? "" : sepStyle);
    return `${absolutePrefix}${joined}`;
  });

// Each property does real filesystem walks (existsSync/realpathSync) per
// run, so we keep numRuns moderate and grant generous per-test timeouts.
const FUZZ_TIMEOUT_MS = 60_000;

describe("fuzz: runtime path-scope normalization never escapes the workspace", () => {
  it("no escape: every returned path is inside the real workspace root", () => {
    const policy = createRuntimePolicyFromParts({
      sessionId: "ses_fuzz",
      task: task(),
      grant: grant(),
      workspaceDir,
    });

    fc.assert(
      fc.property(pathArb, (candidate) => {
        let returned: string;
        try {
          returned = policy.assertPathAllowed(candidate);
        } catch (error) {
          // Rejection is acceptable; the *type* invariant is asserted in
          // the dedicated test below. Here we only constrain successes.
          expect(error).toBeInstanceOf(PlatformPolicyError);
          return;
        }
        // A returned path is a contract that access is granted: it MUST be
        // absolute and MUST sit inside the real workspace root.
        expect(isAbsolute(returned)).toBe(true);
        expect(isInside(returned, realWorkspaceRoot)).toBe(true);
      }),
      { numRuns: 150 },
    );
  }, FUZZ_TIMEOUT_MS);

  it("no crash other than PlatformPolicyError", () => {
    const policy = createRuntimePolicyFromParts({
      sessionId: "ses_fuzz",
      task: task(),
      grant: grant(),
      workspaceDir,
    });

    fc.assert(
      fc.property(pathArb, (candidate) => {
        try {
          policy.assertPathAllowed(candidate);
        } catch (error) {
          // The only sanctioned failure mode is a policy denial.
          if (!(error instanceof PlatformPolicyError)) {
            throw new Error(
              `Unexpected error type for input ${JSON.stringify(candidate)}: ` +
                `${(error as Error)?.constructor?.name}: ${(error as Error)?.message}`,
            );
          }
        }
      }),
      { numRuns: 150 },
    );
  }, FUZZ_TIMEOUT_MS);

  it("explicit allowedPaths to a real subdir still never escapes that subdir", () => {
    // Narrow the allowed scope to a nested real directory and confirm the
    // invariant holds against the tighter boundary too.
    const policy = createRuntimePolicyFromParts({
      sessionId: "ses_fuzz",
      task: task({
        scope: { allowedPaths: ["src/nested"], network: "none" },
      }),
      grant: grant(),
      workspaceDir,
    });
    const realAllowedRoot = realpathSync(join(workspaceDir, "src", "nested"));

    fc.assert(
      fc.property(pathArb, (candidate) => {
        let returned: string;
        try {
          returned = policy.assertPathAllowed(candidate);
        } catch (error) {
          expect(error).toBeInstanceOf(PlatformPolicyError);
          return;
        }
        expect(isInside(returned, realAllowedRoot)).toBe(true);
        // Still inside the overall workspace, transitively.
        expect(isInside(returned, realWorkspaceRoot)).toBe(true);
      }),
      { numRuns: 120 },
    );
  }, FUZZ_TIMEOUT_MS);

  it("disallowed subpaths are never returned even when nominally allowed", () => {
    // allowedPaths covers the whole workspace, but a real nested dir is
    // disallowed. Any candidate resolving inside it must be rejected, never
    // returned.
    const policy = createRuntimePolicyFromParts({
      sessionId: "ses_fuzz",
      task: task({
        scope: {
          allowedPaths: ["."],
          disallowedPaths: ["src/nested"],
          network: "none",
        },
      }),
      grant: grant(),
      workspaceDir,
    });
    const realDisallowed = realpathSync(join(workspaceDir, "src", "nested"));

    fc.assert(
      fc.property(pathArb, (candidate) => {
        let returned: string;
        try {
          returned = policy.assertPathAllowed(candidate);
        } catch (error) {
          expect(error).toBeInstanceOf(PlatformPolicyError);
          return;
        }
        // If it was returned, it must NOT be inside the disallowed subtree
        // and must be inside the workspace.
        expect(isInside(returned, realDisallowed)).toBe(false);
        expect(isInside(returned, realWorkspaceRoot)).toBe(true);
      }),
      { numRuns: 120 },
    );
  }, FUZZ_TIMEOUT_MS);

  it("empty allowedPaths denies every candidate with PlatformPolicyError", () => {
    // scope.allowedPaths === [] (explicit empty) means the default-to-
    // workspace branch is skipped, so allowedPaths.length === 0 and every
    // call must throw the no-allowed-paths error.
    const policy = createRuntimePolicyFromParts({
      sessionId: "ses_fuzz",
      task: task({
        scope: { allowedPaths: [], network: "none" },
      }),
      grant: grant(),
      workspaceDir,
    });

    fc.assert(
      fc.property(pathArb, (candidate) => {
        expect(() => policy.assertPathAllowed(candidate)).toThrow(
          PlatformPolicyError,
        );
      }),
      { numRuns: 150 },
    );
  }, FUZZ_TIMEOUT_MS);

  it("an inactive grant rejects every candidate before any path logic runs", () => {
    const policy = createRuntimePolicyFromParts({
      sessionId: "ses_fuzz",
      task: task(),
      grant: grant({ status: "revoked" }),
      workspaceDir,
    });

    fc.assert(
      fc.property(pathArb, (candidate) => {
        expect(() => policy.assertPathAllowed(candidate)).toThrow(
          /grant is not active/,
        );
      }),
      { numRuns: 150 },
    );
  }, FUZZ_TIMEOUT_MS);
});
