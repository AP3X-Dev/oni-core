import { describe, it, expect, vi, beforeEach } from "vitest";
import { githubTools } from "../github/index.js";
import type { ToolContext } from "../types.js";

// BUG-0282: createPrTool passes `head` and `base` branch names directly to the
// GitHub API body without validation. `owner` and `repo` are sanitized via
// GITHUB_SLUG_RE, but `head` (which supports cross-repo `owner:branch` syntax)
// and `base` have no equivalent check. An LLM-supplied `head` value containing
// CRLF characters, oversized strings, or embedded control characters is forwarded
// verbatim to the GitHub REST API.
//
// Fix: validate `head` and `base` against a branch name regex, rejecting CRLF,
// control characters, and oversized values before the API call.
//
// These tests will FAIL until BUG-0282 is fixed.

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ctx = {} as ToolContext;

describe("BUG-0282: github_create_pr validates head and base branch names", () => {
  const tools = githubTools({
    token: "test-token",
    defaultOwner: "testorg",
    defaultRepo: "testrepo",
  });
  const prTool = tools.find((t) => t.name === "github_create_pr")!;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ number: 1 }),
    });
  });

  it("BUG-0282: rejects head branch name containing CRLF injection", async () => {
    // CRLF in a branch name could split HTTP headers if logged or forwarded unsanitized
    await expect(
      prTool.execute(
        { title: "My PR", head: "feature/test\r\nX-Injected: header", base: "main" },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("BUG-0282: rejects base branch name containing CRLF injection", async () => {
    await expect(
      prTool.execute(
        { title: "My PR", head: "feature/test", base: "main\r\nX-Injected: header" },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("BUG-0282: rejects head branch name with embedded null byte", async () => {
    await expect(
      prTool.execute(
        { title: "My PR", head: "feature/test\x00evil", base: "main" },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("BUG-0282: rejects excessively long head branch name (>255 chars)", async () => {
    const longBranch = "a".repeat(256);
    await expect(
      prTool.execute(
        { title: "My PR", head: longBranch, base: "main" },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("BUG-0282: accepts valid branch name (simple)", async () => {
    await expect(
      prTool.execute(
        { title: "My PR", head: "feature/my-feature", base: "main" },
        ctx,
      ),
    ).resolves.toBeDefined();
  });

  it("BUG-0282: accepts valid cross-repo head reference (owner:branch)", async () => {
    // Cross-repo PRs use owner:branch syntax — this should remain valid
    await expect(
      prTool.execute(
        { title: "My PR", head: "otherowner:feature/fix", base: "main" },
        ctx,
      ),
    ).resolves.toBeDefined();
  });

  it("BUG-0282: accepts valid branch name with dots and underscores", async () => {
    await expect(
      prTool.execute(
        { title: "My PR", head: "release/v1.2.3", base: "develop_stable" },
        ctx,
      ),
    ).resolves.toBeDefined();
  });
});
