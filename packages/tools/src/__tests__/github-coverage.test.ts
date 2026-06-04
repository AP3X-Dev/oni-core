import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { githubTools } from "../github/index.js";
import type { ToolContext } from "../types.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ctx = {} as ToolContext;

/** Build a fake Response whose body is delivered via text() (the primary path). */
function jsonTextResponse(body: unknown, ok = true) {
  return {
    ok,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  };
}

function tool(name: string, cfg?: Parameters<typeof githubTools>[0]) {
  const tools = githubTools(
    cfg ?? { token: "tkn", defaultOwner: "defowner", defaultRepo: "defrepo" }
  );
  return tools.find((t) => t.name === name)!;
}

describe("githubRequest branch coverage", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch.mockReset();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("throws and logs on non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "not used",
    });
    const t = tool("github_create_issue");
    await expect(t.execute({ title: "x" }, ctx)).rejects.toThrow(
      "GitHub API error: 404 Not Found"
    );
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toContain("[github] API error 404 Not Found");
  });

  it("ok=true with text() returns parsed JSON object", async () => {
    mockFetch.mockResolvedValue(jsonTextResponse({ id: 99, number: 3 }));
    const t = tool("github_create_issue");
    const result = await t.execute({ title: "ok" }, ctx);
    expect(result).toEqual({ id: 99, number: 3 });
  });

  it("throws descriptive error when text() body is not valid JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "<html>nope</html>",
    });
    const t = tool("github_create_issue");
    await expect(t.execute({ title: "x" }, ctx)).rejects.toThrow(
      /GitHub API returned non-JSON response.*<html>nope<\/html>/
    );
  });

  it("truncates raw body to 200 chars in the non-JSON error", async () => {
    const big = "Z".repeat(500);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => big,
    });
    const t = tool("github_search_code");
    let caught: Error | undefined;
    try {
      await t.execute({ query: "q" }, ctx);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    // 200 Z's present, 201st Z absent (truncation).
    expect(caught!.message).toContain("Z".repeat(200));
    expect(caught!.message).not.toContain("Z".repeat(201));
  });

  it("falls back to json() when text() is not a function", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ via: "json" }),
    });
    const t = tool("github_create_issue");
    const result = await t.execute({ title: "x" }, ctx);
    expect(result).toEqual({ via: "json" });
  });

  it("throws when neither text() nor json() is exposed", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    const t = tool("github_create_issue");
    await expect(t.execute({ title: "x" }, ctx)).rejects.toThrow(
      /did not expose text\(\) or json\(\)/
    );
  });
});

describe("githubRequest headers / body shape", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonTextResponse({ id: 1 }));
  });

  it("sends Bearer auth, Accept and api-version headers plus Content-Type for a body", async () => {
    const t = tool("github_create_issue", { token: "secret", defaultOwner: "o", defaultRepo: "r" });
    await t.execute({ title: "Hi" }, ctx);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/o/r/issues");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer secret",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    });
    expect(typeof init.body).toBe("string");
  });

  it("omits Content-Type and body on GET requests (no body branch)", async () => {
    mockFetch.mockResolvedValue(jsonTextResponse([]));
    const t = tool("github_list_issues", { token: "t", defaultOwner: "o", defaultRepo: "r" });
    await t.execute({}, ctx);
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("GET");
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init).not.toHaveProperty("body");
  });
});

describe("github_create_issue branches", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonTextResponse({ id: 1 }));
  });

  it("includes labels and assignees when provided", async () => {
    const t = tool("github_create_issue");
    await t.execute(
      {
        owner: "ow",
        repo: "rp",
        title: "T",
        body: "B",
        labels: ["bug", "p1"],
        assignees: ["alice"],
      },
      ctx
    );
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/ow/rp/issues");
    expect(JSON.parse(init.body)).toEqual({
      title: "T",
      body: "B",
      labels: ["bug", "p1"],
      assignees: ["alice"],
    });
  });

  it("falls back to config default owner/repo when omitted", async () => {
    const t = tool("github_create_issue", {
      token: "t",
      defaultOwner: "dflt-o",
      defaultRepo: "dflt-r",
    });
    await t.execute({ title: "No org given" }, ctx);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/dflt-o/dflt-r/issues");
    // labels/assignees omitted -> undefined in serialized body (dropped by JSON.stringify)
    const parsed = JSON.parse(init.body);
    expect(parsed).toEqual({ title: "No org given" });
    expect(parsed).not.toHaveProperty("labels");
    expect(parsed).not.toHaveProperty("assignees");
  });

  it("rejects an invalid owner slug", async () => {
    const t = tool("github_create_issue", { token: "t" });
    await expect(
      t.execute({ owner: "bad owner!", repo: "r", title: "x" }, ctx)
    ).rejects.toThrow(/Invalid GitHub owner/);
  });

  it("rejects an invalid repo slug", async () => {
    const t = tool("github_create_issue", { token: "t" });
    await expect(
      t.execute({ owner: "good", repo: "bad/repo", title: "x" }, ctx)
    ).rejects.toThrow(/Invalid GitHub repo/);
  });
});

describe("github_list_issues branches", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonTextResponse([]));
  });

  it("applies default state/per_page/page and omits labels when absent", async () => {
    const t = tool("github_list_issues");
    await t.execute({ owner: "o", repo: "r" }, ctx);
    const [url, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("GET");
    const u = new URL(url);
    expect(u.pathname).toBe("/repos/o/r/issues");
    expect(u.searchParams.get("state")).toBe("open");
    expect(u.searchParams.get("per_page")).toBe("30");
    expect(u.searchParams.get("page")).toBe("1");
    expect(u.searchParams.has("labels")).toBe(false);
  });

  it("honors explicit state, pagination and label filter", async () => {
    const t = tool("github_list_issues");
    await t.execute(
      { owner: "o", repo: "r", state: "closed", perPage: 100, page: 5, labels: "bug,p1" },
      ctx
    );
    const [url] = mockFetch.mock.calls[0];
    const u = new URL(url);
    expect(u.searchParams.get("state")).toBe("closed");
    expect(u.searchParams.get("per_page")).toBe("100");
    expect(u.searchParams.get("page")).toBe("5");
    expect(u.searchParams.get("labels")).toBe("bug,p1");
  });

  it("throws when owner cannot be resolved", async () => {
    const t = tool("github_list_issues", { token: "t" });
    await expect(t.execute({}, ctx)).rejects.toThrow(/owner is required/);
  });
});

describe("github_create_pr branches", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonTextResponse({ number: 7 }));
  });

  it("defaults base to main and draft to false", async () => {
    const t = tool("github_create_pr");
    await t.execute({ owner: "o", repo: "r", title: "PR", head: "feature" }, ctx);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/o/r/pulls");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      title: "PR",
      head: "feature",
      base: "main",
      draft: false,
    });
  });

  it("honors explicit base and draft=true", async () => {
    const t = tool("github_create_pr");
    await t.execute(
      { owner: "o", repo: "r", title: "PR", head: "feat/x", base: "develop", body: "desc", draft: true },
      ctx
    );
    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      title: "PR",
      body: "desc",
      head: "feat/x",
      base: "develop",
      draft: true,
    });
  });

  it("rejects an empty head branch name", async () => {
    const t = tool("github_create_pr");
    await expect(
      t.execute({ owner: "o", repo: "r", title: "PR", head: "" }, ctx)
    ).rejects.toThrow(/head branch name must not be empty/);
  });

  it("rejects a head branch with invalid characters", async () => {
    const t = tool("github_create_pr");
    await expect(
      t.execute({ owner: "o", repo: "r", title: "PR", head: "bad branch~" }, ctx)
    ).rejects.toThrow(/head branch name contains invalid characters/);
  });

  it("rejects an over-length base branch name", async () => {
    const t = tool("github_create_pr");
    const longBase = "b".repeat(256);
    await expect(
      t.execute({ owner: "o", repo: "r", title: "PR", head: "ok", base: longBase }, ctx)
    ).rejects.toThrow(/base branch name exceeds maximum length/);
  });
});

describe("github_search_code branches", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonTextResponse({ items: [] }));
  });

  it("uses default pagination and encodes the query", async () => {
    const t = tool("github_search_code", { token: "t" });
    await t.execute({ query: "addEventListener repo:foo/bar" }, ctx);
    const [url, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("GET");
    const u = new URL(url);
    expect(u.pathname).toBe("/search/code");
    expect(u.searchParams.get("q")).toBe("addEventListener repo:foo/bar");
    expect(u.searchParams.get("per_page")).toBe("30");
    expect(u.searchParams.get("page")).toBe("1");
  });

  it("honors explicit pagination", async () => {
    const t = tool("github_search_code", { token: "t" });
    await t.execute({ query: "foo", perPage: 50, page: 2 }, ctx);
    const [url] = mockFetch.mock.calls[0];
    const u = new URL(url);
    expect(u.searchParams.get("per_page")).toBe("50");
    expect(u.searchParams.get("page")).toBe("2");
  });

  it("does not require owner/repo (no resolveOwner)", async () => {
    // token-only config; search_code should still work since it skips owner/repo.
    const t = tool("github_search_code", { token: "t" });
    await expect(t.execute({ query: "x" }, ctx)).resolves.toBeDefined();
  });
});

describe("github_add_comment branches", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonTextResponse({ id: 555 }));
  });

  it("posts a comment with the correct URL and body", async () => {
    const t = tool("github_add_comment");
    await t.execute({ owner: "o", repo: "r", issueNumber: 12, body: "hello" }, ctx);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/o/r/issues/12/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ body: "hello" });
  });

  it("uses default owner/repo from config", async () => {
    const t = tool("github_add_comment", {
      token: "t",
      defaultOwner: "co",
      defaultRepo: "cr",
    });
    await t.execute({ issueNumber: 1, body: "hi" }, ctx);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/co/cr/issues/1/comments");
  });

  it("rejects a non-integer issue number", async () => {
    const t = tool("github_add_comment");
    await expect(
      t.execute({ owner: "o", repo: "r", issueNumber: 1.5, body: "x" }, ctx)
    ).rejects.toThrow(/Invalid issue number/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a non-positive issue number", async () => {
    const t = tool("github_add_comment");
    await expect(
      t.execute({ owner: "o", repo: "r", issueNumber: 0, body: "x" }, ctx)
    ).rejects.toThrow(/Invalid issue number/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
