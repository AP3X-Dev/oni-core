import { describe, it, expect, vi, beforeEach } from "vitest";
import { githubTools } from "../github/index.js";
import type { ToolContext } from "../types.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ctx = {} as ToolContext;

describe("githubTools", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns an array of ToolDefinitions", () => {
    const tools = githubTools({ token: "test-token" });
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("includes all expected tool names", () => {
    const tools = githubTools({ token: "test-token" });
    const names = tools.map((t) => t.name);
    expect(names).toContain("github_create_issue");
    expect(names).toContain("github_list_issues");
    expect(names).toContain("github_create_pr");
    expect(names).toContain("github_search_code");
    expect(names).toContain("github_add_comment");
  });

  it("returns 5 tools", () => {
    const tools = githubTools({ token: "test-token" });
    expect(tools).toHaveLength(5);
  });

  it("all tools have schema with type object", () => {
    const tools = githubTools({ token: "test-token" });
    for (const tool of tools) {
      expect(tool.schema.type).toBe("object");
    }
  });

  it("github_search_code is parallelSafe", () => {
    const tools = githubTools({ token: "test-token" });
    const searchTool = tools.find((t) => t.name === "github_search_code")!;
    expect(searchTool.parallelSafe).toBe(true);
  });

  it("github_create_issue is not parallelSafe", () => {
    const tools = githubTools({ token: "test-token" });
    const createTool = tools.find((t) => t.name === "github_create_issue")!;
    expect(createTool.parallelSafe).toBe(false);
  });

  it("uses Authorization Bearer header", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    const tools = githubTools({
      token: "my-token",
      defaultOwner: "testowner",
      defaultRepo: "testrepo",
    });
    const createTool = tools.find((t) => t.name === "github_create_issue")!;
    await createTool.execute({ title: "Test issue" }, ctx);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("github.com"),
      expect.objectContaining({
        headers: expect.objectContaining({ "Authorization": "Bearer my-token" }),
      })
    );
  });

  it("throws if owner not provided and no default", async () => {
    const tools = githubTools({ token: "test-token" });
    const createTool = tools.find((t) => t.name === "github_create_issue")!;
    await expect(
      createTool.execute({ title: "Test" }, ctx)
    ).rejects.toThrow("owner is required");
  });

  it("throws if repo not provided and no default", async () => {
    const tools = githubTools({ token: "test-token", defaultOwner: "myorg" });
    const createTool = tools.find((t) => t.name === "github_create_issue")!;
    await expect(
      createTool.execute({ title: "Test" }, ctx)
    ).rejects.toThrow("repo is required");
  });

  it("github_search_code requires query in schema", () => {
    const tools = githubTools({ token: "test-token" });
    const searchTool = tools.find((t) => t.name === "github_search_code")!;
    expect(searchTool.schema.required).toContain("query");
  });

  it("github_create_pr requires title and head in schema", () => {
    const tools = githubTools({ token: "test-token" });
    const prTool = tools.find((t) => t.name === "github_create_pr")!;
    expect(prTool.schema.required).toContain("title");
    expect(prTool.schema.required).toContain("head");
  });
});
