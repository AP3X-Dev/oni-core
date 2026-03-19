import { describe, it, expect, vi, beforeEach } from "vitest";
import { githubTools } from "../github/index.js";
import type { ToolContext } from "../types.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ctx = {} as ToolContext;

describe("BUG-0241: githubRequest throws descriptive error on malformed JSON response body", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("BUG-0241: should throw a descriptive error when GitHub returns a 200 with non-JSON body", async () => {
    // Simulate a 200 OK response with a non-JSON body (e.g., proxy injection or API incident)
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => "<html>Bad Gateway</html>",
    });

    const tools = githubTools({
      token: "test-token",
      defaultOwner: "testowner",
      defaultRepo: "testrepo",
    });
    const createTool = tools.find((t) => t.name === "github_create_issue")!;

    // Before the fix, res.json() would throw an opaque SyntaxError.
    // After the fix, the error message includes method, path, and raw body excerpt.
    await expect(
      createTool.execute({ title: "Test Issue" }, ctx)
    ).rejects.toThrow(/GitHub API returned non-JSON response/);
  });

  it("BUG-0241: error message includes method, path, and first 200 chars of body", async () => {
    const rawBody = "plain text response body that is not JSON";
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => rawBody,
    });

    const tools = githubTools({
      token: "test-token",
      defaultOwner: "testowner",
      defaultRepo: "testrepo",
    });
    const searchTool = tools.find((t) => t.name === "github_search_code")!;

    await expect(
      searchTool.execute({ query: "hello world" }, ctx)
    ).rejects.toThrow(rawBody.slice(0, 200));
  });

  it("BUG-0241: valid JSON response continues to work correctly", async () => {
    const responseBody = { id: 42, number: 7, html_url: "https://github.com/test/repo/issues/7" };
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(responseBody),
    });

    const tools = githubTools({
      token: "test-token",
      defaultOwner: "testowner",
      defaultRepo: "testrepo",
    });
    const createTool = tools.find((t) => t.name === "github_create_issue")!;

    // Should not throw — valid JSON parses successfully
    const result = await createTool.execute({ title: "Valid Issue" }, ctx);
    expect(result).toEqual(expect.objectContaining({ id: 42 }));
  });
});
