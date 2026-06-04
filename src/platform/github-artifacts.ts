// ============================================================
// @oni.bot/core/platform - GitHub artifact publication
// ============================================================
// Publishes platform artifacts to GitHub review surfaces while
// keeping a local/mirrored ArtifactStore record for list() calls.
// ============================================================

import type {
  ArtifactStore,
  OutputArtifact,
  OutputArtifactType,
} from "./types.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitHubArtifactStoreOptions {
  token: string;
  owner: string;
  repo: string;
  apiBaseUrl?: string;
  userAgent?: string;
  fetch?: FetchLike;
  mirror?: ArtifactStore;
  defaultIssueNumber?: number;
  defaultPullNumber?: number;
  defaultBaseBranch?: string;
  maxBodyChars?: number;
}

export interface GitHubArtifactPublishMetadata {
  publish?: boolean;
  owner?: string;
  repo?: string;
  issueNumber?: number;
  pullNumber?: number;
  head?: string;
  base?: string;
  title?: string;
  body?: string;
}

interface GitHubApiResult {
  id?: number | string;
  number?: number;
  url?: string;
  html_url?: string;
}

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_MAX_BODY_CHARS = 60_000;
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function validateName(label: string, value: string): void {
  if (!NAME_PATTERN.test(value)) {
    throw new Error(`Invalid GitHub ${label}: ${value}`);
  }
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const raw = value ?? DEFAULT_API_BASE_URL;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("GitHub API base URL must use http or https.");
  }
  return raw.replace(/\/+$/, "");
}

function metadataFor(artifact: OutputArtifact): {
  root: Record<string, unknown>;
  github: Record<string, unknown>;
} {
  const root = artifact.metadata ?? {};
  return {
    root,
    github: asRecord(root.github) ?? {},
  };
}

function metadataString(
  metadata: { root: Record<string, unknown>; github: Record<string, unknown> },
  key: keyof GitHubArtifactPublishMetadata,
): string | undefined {
  return optionalString(metadata.github[key]) ?? optionalString(metadata.root[key]);
}

function metadataNumber(
  metadata: { root: Record<string, unknown>; github: Record<string, unknown> },
  key: keyof GitHubArtifactPublishMetadata,
): number | undefined {
  return optionalNumber(metadata.github[key]) ?? optionalNumber(metadata.root[key]);
}

function shouldPublish(artifact: OutputArtifact): boolean {
  const metadata = metadataFor(artifact);
  return metadata.github.publish !== false && metadata.root.publish !== false;
}

function truncateBody(body: string, maxChars: number): { body: string; truncated: boolean } {
  if (body.length <= maxChars) return { body, truncated: false };
  const marker = "\n\n[artifact body truncated by ONI platform GitHub publisher]";
  return {
    body: `${body.slice(0, Math.max(0, maxChars - marker.length))}${marker}`,
    truncated: true,
  };
}

function defaultArtifactBody(artifact: OutputArtifact): string {
  const lines = [
    `## ${artifact.title}`,
    "",
    `Type: \`${artifact.type}\``,
  ];
  if (artifact.content) {
    lines.push("", artifact.content);
  }
  if (artifact.uri) {
    lines.push("", `Artifact URI: ${artifact.uri}`);
  }
  return lines.join("\n");
}

function bodyFor(
  artifact: OutputArtifact,
  maxChars: number,
): { body: string; truncated: boolean } {
  const metadata = metadataFor(artifact);
  const override = metadataString(metadata, "body");
  return truncateBody(override ?? defaultArtifactBody(artifact), maxChars);
}

function responseText(response: Response): Promise<string> {
  return response.text();
}

async function parseGitHubResponse(response: Response): Promise<GitHubApiResult> {
  const text = await responseText(response);
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as GitHubApiResult;
  } catch {
    throw new Error("GitHub API returned a non-JSON response.");
  }
}

function publishedArtifact(
  artifact: OutputArtifact,
  options: {
    owner: string;
    repo: string;
    kind: "issue_comment" | "pull_request";
    apiUrl?: string;
    htmlUrl?: string;
    id?: number | string;
    number?: number;
    bodyTruncated: boolean;
  },
): OutputArtifact {
  const existingMetadata = artifact.metadata ?? {};
  const existingGitHub = asRecord(existingMetadata.github) ?? {};
  return {
    ...artifact,
    uri: artifact.uri ?? options.htmlUrl ?? options.apiUrl,
    metadata: {
      ...existingMetadata,
      github: {
        ...existingGitHub,
        owner: options.owner,
        repo: options.repo,
        kind: options.kind,
        published: true,
        bodyTruncated: options.bodyTruncated,
        id: options.id,
        number: options.number,
        apiUrl: options.apiUrl,
        url: options.htmlUrl,
      },
    },
  };
}

function publicationTarget(
  artifact: OutputArtifact,
  options: GitHubArtifactStoreOptions,
): {
  owner: string;
  repo: string;
  issueNumber?: number;
  head?: string;
  base?: string;
  title?: string;
} {
  const metadata = metadataFor(artifact);
  const owner = metadataString(metadata, "owner") ?? options.owner;
  const repo = metadataString(metadata, "repo") ?? options.repo;
  validateName("owner", owner);
  validateName("repo", repo);

  const pullNumber = metadataNumber(metadata, "pullNumber") ?? options.defaultPullNumber;
  const issueNumber =
    metadataNumber(metadata, "issueNumber") ??
    pullNumber ??
    options.defaultIssueNumber;

  return {
    owner,
    repo,
    issueNumber,
    head: metadataString(metadata, "head"),
    base: metadataString(metadata, "base") ?? options.defaultBaseBranch,
    title: metadataString(metadata, "title"),
  };
}

function methodForArtifact(type: OutputArtifactType): "comment" | "pull_request" {
  return type === "pull_request" ? "pull_request" : "comment";
}

export class GitHubArtifactStore implements ArtifactStore {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxBodyChars: number;
  private readonly localArtifacts = new Map<string, OutputArtifact[]>();

  constructor(private readonly options: GitHubArtifactStoreOptions) {
    if (!options.token.trim()) {
      throw new Error("GitHubArtifactStore token is required.");
    }
    validateName("owner", options.owner);
    validateName("repo", options.repo);
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
  }

  async put(artifact: OutputArtifact): Promise<OutputArtifact> {
    const finalArtifact = shouldPublish(artifact)
      ? await this.publish(artifact)
      : cloneRecord(artifact);
    return this.save(finalArtifact);
  }

  async list(sessionId: string): Promise<OutputArtifact[]> {
    if (this.options.mirror) {
      return this.options.mirror.list(sessionId);
    }
    return (this.localArtifacts.get(sessionId) ?? []).map((artifact) => cloneRecord(artifact));
  }

  private async save(artifact: OutputArtifact): Promise<OutputArtifact> {
    if (this.options.mirror) {
      const mirrored = await this.options.mirror.put(artifact);
      return mirrored ? cloneRecord(mirrored) : cloneRecord(artifact);
    }

    const list = this.localArtifacts.get(artifact.sessionId) ?? [];
    const existingIndex = list.findIndex((item) => item.id === artifact.id);
    if (existingIndex >= 0) {
      list[existingIndex] = cloneRecord(artifact);
    } else {
      list.push(cloneRecord(artifact));
    }
    this.localArtifacts.set(artifact.sessionId, list);
    return cloneRecord(artifact);
  }

  private async publish(artifact: OutputArtifact): Promise<OutputArtifact> {
    const target = publicationTarget(artifact, this.options);
    const mode = methodForArtifact(artifact.type);
    if (mode === "pull_request") {
      return this.createPullRequest(artifact, target);
    }
    return this.createIssueComment(artifact, target);
  }

  private async createIssueComment(
    artifact: OutputArtifact,
    target: ReturnType<typeof publicationTarget>,
  ): Promise<OutputArtifact> {
    if (!target.issueNumber) {
      throw new Error("GitHub artifact publication requires issueNumber or pullNumber metadata.");
    }
    const body = bodyFor(artifact, this.maxBodyChars);
    const path = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/${target.issueNumber}/comments`;
    const result = await this.request(path, "POST", { body: body.body });
    return publishedArtifact(artifact, {
      owner: target.owner,
      repo: target.repo,
      kind: "issue_comment",
      apiUrl: result.url,
      htmlUrl: result.html_url,
      id: result.id,
      number: target.issueNumber,
      bodyTruncated: body.truncated,
    });
  }

  private async createPullRequest(
    artifact: OutputArtifact,
    target: ReturnType<typeof publicationTarget>,
  ): Promise<OutputArtifact> {
    if (!target.head) {
      throw new Error("GitHub pull_request artifact publication requires head metadata.");
    }
    if (!target.base) {
      throw new Error("GitHub pull_request artifact publication requires base metadata.");
    }
    const body = bodyFor(artifact, this.maxBodyChars);
    const path = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/pulls`;
    const result = await this.request(path, "POST", {
      title: target.title ?? artifact.title,
      head: target.head,
      base: target.base,
      body: body.body,
    });
    return publishedArtifact(artifact, {
      owner: target.owner,
      repo: target.repo,
      kind: "pull_request",
      apiUrl: result.url,
      htmlUrl: result.html_url,
      id: result.id,
      number: result.number,
      bodyTruncated: body.truncated,
    });
  }

  private async request(path: string, method: string, body: Record<string, unknown>): Promise<GitHubApiResult> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${this.options.token}`,
        "Content-Type": "application/json",
        "User-Agent": this.options.userAgent ?? "oni-core-platform",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });
    return parseGitHubResponse(response);
  }
}
