// Regression test for BUG-0282
// Before the fix, createPrTool passed head and base branch names directly to
// the GitHub API body without validation. owner/repo were sanitized via GITHUB_SLUG_RE,
// but head (which supports cross-repo owner:branch syntax) and base had no equivalent check.
// The fix adds validateBranchName() for both head and base in createPrTool.execute().

import { describe, it, expect, vi } from "vitest";
import { githubTools } from "../../packages/tools/src/github/index.js";

function makeConfig() {
  return {
    token: "ghp_test_token",
    defaultOwner: "test-owner",
    defaultRepo: "test-repo",
  };
}

function getPrTool() {
  const tools = githubTools(makeConfig());
  const pr = tools.find((t) => t.name === "github_create_pr");
  if (!pr) throw new Error("github_create_pr tool not found");
  return pr;
}

describe("create_pull_request — branch name validation (BUG-0282)", () => {
  it("BUG-0282: rejects head branch name with CRLF injection", async () => {
    const pr = getPrTool();
    await expect(
      pr.execute({
        owner: "test-owner",
        repo: "test-repo",
        title: "Test PR",
        head: "feature/test\r\nX-Injected: evil",
        base: "main",
        body: "",
      }),
    ).rejects.toThrow(/invalid characters/i);
  });

  it("BUG-0282: rejects base branch name with newline injection", async () => {
    const pr = getPrTool();
    await expect(
      pr.execute({
        owner: "test-owner",
        repo: "test-repo",
        title: "Test PR",
        head: "feature/legit",
        base: "main\nDropped-Header: injected",
        body: "",
      }),
    ).rejects.toThrow(/invalid characters/i);
  });

  it("BUG-0282: rejects head branch name that exceeds max length", async () => {
    const pr = getPrTool();
    const tooLong = "a".repeat(256);
    await expect(
      pr.execute({
        owner: "test-owner",
        repo: "test-repo",
        title: "Test PR",
        head: tooLong,
        base: "main",
        body: "",
      }),
    ).rejects.toThrow(/exceeds maximum length/i);
  });

  it("BUG-0282: accepts valid cross-repo head reference (owner:branch)", async () => {
    // The fix must allow the legitimate cross-repo PR format owner:branch
    const pr = getPrTool();

    // We cannot make a real GitHub API call — mock fetch to verify validation passes
    const originalFetch = global.fetch;
    const responseBody = JSON.stringify({
      number: 42,
      html_url: "https://github.com/test-owner/test-repo/pull/42",
      title: "Test PR",
      state: "open",
      head: { ref: "feature-branch" },
      base: { ref: "main" },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => responseBody,
    } as unknown as Response);

    try {
      const result = await pr.execute({
        owner: "test-owner",
        repo: "test-repo",
        title: "Test PR",
        head: "fork-owner:feature-branch",
        base: "main",
        body: "",
      });
      // If we reach here, validation passed (valid cross-repo ref allowed)
      expect(result).toBeDefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("BUG-0282: accepts normal valid branch names for head and base", async () => {
    const pr = getPrTool();

    const originalFetch = global.fetch;
    const responseBody = JSON.stringify({
      number: 1,
      html_url: "https://github.com/test-owner/test-repo/pull/1",
      title: "Test PR",
      state: "open",
      head: { ref: "feature/my-fix" },
      base: { ref: "main" },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => responseBody,
    } as unknown as Response);

    try {
      const result = await pr.execute({
        owner: "test-owner",
        repo: "test-repo",
        title: "Test PR",
        head: "feature/my-fix",
        base: "main",
        body: "Description",
      });
      expect(result).toBeDefined();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
