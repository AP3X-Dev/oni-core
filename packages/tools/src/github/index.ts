import type { ToolDefinition, ToolContext } from "../types.js";

interface GitHubConfig {
  token: string;
  defaultOwner?: string;
  defaultRepo?: string;
}

interface WithOwnerRepo {
  owner?: string;
  repo?: string;
}

interface CreateIssueInput extends WithOwnerRepo {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

interface ListIssuesInput extends WithOwnerRepo {
  state?: "open" | "closed" | "all";
  labels?: string;
  perPage?: number;
  page?: number;
}

interface CreatePrInput extends WithOwnerRepo {
  title: string;
  body?: string;
  head: string;
  base?: string;
  draft?: boolean;
}

interface SearchCodeInput {
  query: string;
  perPage?: number;
  page?: number;
}

interface AddCommentInput extends WithOwnerRepo {
  issueNumber: number;
  body: string;
}

async function githubRequest(
  path: string,
  method: string,
  token: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    console.error(`[github] API error ${res.status} ${res.statusText} ${method} ${path}`);
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub API returned non-JSON response for ${method} ${path}: ${text.slice(0, 200)}`);
  }
}

const GITHUB_SLUG_RE = /^[a-zA-Z0-9._-]+$/;

/** Allowed branch name pattern: word chars, hyphens, dots, slashes, colons. */
const BRANCH_NAME_RE = /^[\w\-\.\/\:]+$/;
const MAX_BRANCH_LENGTH = 255;

function validateBranchName(name: string, label: string): void {
  if (name.length === 0) {
    throw new Error(`${label} branch name must not be empty`);
  }
  if (name.length > MAX_BRANCH_LENGTH) {
    throw new Error(
      `${label} branch name exceeds maximum length of ${MAX_BRANCH_LENGTH} characters`
    );
  }
  if (!BRANCH_NAME_RE.test(name)) {
    throw new Error(
      `${label} branch name contains invalid characters — ` +
        `only word characters, hyphens, dots, slashes, and colons are allowed`
    );
  }
}

export function githubTools(config: GitHubConfig): ToolDefinition[] {
  function resolveOwner(input: WithOwnerRepo): string {
    const owner = input.owner ?? config.defaultOwner;
    if (!owner) throw new Error("owner is required (not set in input or config)");
    if (!GITHUB_SLUG_RE.test(owner))
      throw new Error(`Invalid GitHub owner: ${owner}`);
    return owner;
  }

  function resolveRepo(input: WithOwnerRepo): string {
    const repo = input.repo ?? config.defaultRepo;
    if (!repo) throw new Error("repo is required (not set in input or config)");
    if (!GITHUB_SLUG_RE.test(repo))
      throw new Error(`Invalid GitHub repo: ${repo}`);
    return repo;
  }

  const createIssueTool: ToolDefinition = {
    name: "github_create_issue",
    description: "Create a new issue in a GitHub repository",
    schema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner (uses config default if omitted)" },
        repo: { type: "string", description: "Repository name (uses config default if omitted)" },
        title: { type: "string", description: "Issue title" },
        body: { type: "string", description: "Issue body (markdown)" },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Labels to apply",
        },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: "GitHub usernames to assign",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as CreateIssueInput;
      const owner = resolveOwner(i);
      const repo = resolveRepo(i);
      return githubRequest(`/repos/${owner}/${repo}/issues`, "POST", config.token, {
        title: i.title,
        body: i.body,
        labels: i.labels,
        assignees: i.assignees,
      });
    },
  };

  const listIssuesTool: ToolDefinition = {
    name: "github_list_issues",
    description: "List issues in a GitHub repository",
    schema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner (uses config default if omitted)" },
        repo: { type: "string", description: "Repository name (uses config default if omitted)" },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          description: "Issue state filter (default: open)",
        },
        labels: { type: "string", description: "Comma-separated label names to filter by" },
        perPage: { type: "number", description: "Results per page (default 30, max 100)" },
        page: { type: "number", description: "Page number (default 1)" },
      },
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as ListIssuesInput;
      const owner = resolveOwner(i);
      const repo = resolveRepo(i);
      const params = new URLSearchParams({
        state: i.state ?? "open",
        per_page: String(i.perPage ?? 30),
        page: String(i.page ?? 1),
        ...(i.labels ? { labels: i.labels } : {}),
      });
      return githubRequest(
        `/repos/${owner}/${repo}/issues?${params.toString()}`,
        "GET",
        config.token
      );
    },
  };

  const createPrTool: ToolDefinition = {
    name: "github_create_pr",
    description: "Create a pull request in a GitHub repository",
    schema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner (uses config default if omitted)" },
        repo: { type: "string", description: "Repository name (uses config default if omitted)" },
        title: { type: "string", description: "Pull request title" },
        body: { type: "string", description: "Pull request description (markdown)" },
        head: { type: "string", description: "Branch containing the changes" },
        base: { type: "string", description: "Branch to merge into (default: main)" },
        draft: { type: "boolean", description: "Create as draft PR (default: false)" },
      },
      required: ["title", "head"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as CreatePrInput;
      const owner = resolveOwner(i);
      const repo = resolveRepo(i);
      validateBranchName(i.head, "head");
      const base = i.base ?? "main";
      validateBranchName(base, "base");
      return githubRequest(`/repos/${owner}/${repo}/pulls`, "POST", config.token, {
        title: i.title,
        body: i.body,
        head: i.head,
        base,
        draft: i.draft ?? false,
      });
    },
  };

  const searchCodeTool: ToolDefinition = {
    name: "github_search_code",
    description: "Search for code across GitHub repositories",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (supports GitHub search syntax)" },
        perPage: { type: "number", description: "Results per page (default 30, max 100)" },
        page: { type: "number", description: "Page number (default 1)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as SearchCodeInput;
      const params = new URLSearchParams({
        q: i.query,
        per_page: String(i.perPage ?? 30),
        page: String(i.page ?? 1),
      });
      return githubRequest(`/search/code?${params.toString()}`, "GET", config.token);
    },
  };

  const addCommentTool: ToolDefinition = {
    name: "github_add_comment",
    description: "Add a comment to a GitHub issue or pull request",
    schema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner (uses config default if omitted)" },
        repo: { type: "string", description: "Repository name (uses config default if omitted)" },
        issueNumber: { type: "number", description: "Issue or PR number" },
        body: { type: "string", description: "Comment body (markdown)" },
      },
      required: ["issueNumber", "body"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as AddCommentInput;
      if (!Number.isInteger(i.issueNumber) || i.issueNumber <= 0)
        throw new Error(`Invalid issue number: ${i.issueNumber}`);
      const owner = resolveOwner(i);
      const repo = resolveRepo(i);
      return githubRequest(
        `/repos/${owner}/${repo}/issues/${i.issueNumber}/comments`,
        "POST",
        config.token,
        { body: i.body }
      );
    },
  };

  return [createIssueTool, listIssuesTool, createPrTool, searchCodeTool, addCommentTool];
}
