import { describe, expect, it, vi } from "vitest";
import {
  GitHubArtifactStore,
  InMemoryArtifactStore,
  type OutputArtifact,
} from "../index.js";

function artifact(overrides: Partial<OutputArtifact> = {}): OutputArtifact {
  return {
    id: "art_1",
    sessionId: "ses_1",
    type: "report",
    title: "Run report",
    content: "The agent completed the task.",
    createdAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 201, statusText = "Created"): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitHubArtifactStore", () => {
  it("publishes report artifacts as issue or pull request comments", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        id: 123,
        url: "https://api.github.com/comment/123",
        html_url: "https://github.com/ap3x/oni/pull/42#issuecomment-123",
      });
    });
    const store = new GitHubArtifactStore({
      token: "ghs_secret_token",
      owner: "ap3x",
      repo: "oni",
      defaultPullNumber: 42,
      fetch,
    });

    const published = await store.put(artifact());

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls[0]?.url).toBe("https://api.github.com/repos/ap3x/oni/issues/42/comments");
    expect(calls[0]?.init?.headers).toMatchObject({
      "Authorization": "Bearer ghs_secret_token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      body: expect.stringContaining("The agent completed the task."),
    });
    expect(published.uri).toBe("https://github.com/ap3x/oni/pull/42#issuecomment-123");
    expect(published.metadata?.github).toMatchObject({
      owner: "ap3x",
      repo: "oni",
      kind: "issue_comment",
      published: true,
      number: 42,
    });
    expect(JSON.stringify(published.metadata)).not.toContain("ghs_secret_token");
    await expect(store.list("ses_1")).resolves.toEqual([published]);
  });

  it("creates pull requests for pull_request artifacts and returns the published URI", async () => {
    const fetch = vi.fn(async () => jsonResponse({
      id: 456,
      number: 7,
      url: "https://api.github.com/pulls/7",
      html_url: "https://github.com/ap3x/oni/pull/7",
    }));
    const store = new GitHubArtifactStore({
      token: "ghs_secret_token",
      owner: "ap3x",
      repo: "oni",
      fetch,
    });

    const published = await store.put(artifact({
      type: "pull_request",
      title: "Agent patch",
      content: "Implements the hardening pass.",
      metadata: {
        github: {
          head: "agent/hardening",
          base: "main",
          title: "Harden background-agent artifacts",
        },
      },
    }));

    const [, request] = fetch.mock.calls[0] ?? [];
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/ap3x/oni/pulls");
    expect(JSON.parse(String(request?.body))).toEqual({
      title: "Harden background-agent artifacts",
      head: "agent/hardening",
      base: "main",
      body: expect.stringContaining("Implements the hardening pass."),
    });
    expect(published.uri).toBe("https://github.com/ap3x/oni/pull/7");
    expect(published.metadata?.github).toMatchObject({
      kind: "pull_request",
      number: 7,
      published: true,
    });
  });

  it("can mirror enriched artifacts into another artifact store", async () => {
    const mirror = new InMemoryArtifactStore();
    const store = new GitHubArtifactStore({
      token: "ghs_secret_token",
      owner: "ap3x",
      repo: "oni",
      defaultIssueNumber: 99,
      mirror,
      fetch: vi.fn(async () => jsonResponse({
        id: 789,
        html_url: "https://github.com/ap3x/oni/issues/99#issuecomment-789",
      })),
    });

    const published = await store.put(artifact({ id: "art_mirror" }));

    expect(mirror.list("ses_1")).toEqual([published]);
    await expect(store.list("ses_1")).resolves.toEqual([published]);
  });

  it("stores artifacts without network calls when publication is disabled", async () => {
    const fetch = vi.fn();
    const store = new GitHubArtifactStore({
      token: "ghs_secret_token",
      owner: "ap3x",
      repo: "oni",
      defaultIssueNumber: 99,
      fetch,
    });
    const localOnly = artifact({
      metadata: { github: { publish: false } },
    });

    const stored = await store.put(localOnly);

    expect(fetch).not.toHaveBeenCalled();
    expect(stored).toEqual(localOnly);
    await expect(store.list("ses_1")).resolves.toEqual([localOnly]);
  });

  it("fails closed when a comment artifact has no issue or pull request target", async () => {
    const fetch = vi.fn();
    const store = new GitHubArtifactStore({
      token: "ghs_secret_token",
      owner: "ap3x",
      repo: "oni",
      fetch,
    });

    await expect(store.put(artifact())).rejects.toThrow("requires issueNumber or pullNumber");
    expect(fetch).not.toHaveBeenCalled();
    await expect(store.list("ses_1")).resolves.toEqual([]);
  });

  it("reports GitHub API failures without leaking response bodies or tokens", async () => {
    const store = new GitHubArtifactStore({
      token: "ghs_secret_token",
      owner: "ap3x",
      repo: "oni",
      defaultIssueNumber: 99,
      fetch: vi.fn(async () => jsonResponse({ message: "bad credentials ghs_secret_token" }, 401, "Unauthorized")),
    });

    await expect(store.put(artifact())).rejects.toThrow("GitHub API error: 401 Unauthorized");
    try {
      await store.put(artifact());
    } catch (error) {
      expect(String(error)).not.toContain("ghs_secret_token");
    }
  });
});
