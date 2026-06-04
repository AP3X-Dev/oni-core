// ============================================================
// @oni.bot/core/platform - HTTP execution environment provider
// ============================================================
// Provider seam for cloud devboxes and Cerebro-style environment
// services. The provider owns API transport, while the platform still
// receives a normal ExecutionEnvironment record.
// ============================================================

import type {
  EnvironmentSize,
  ExecutionEnvironment,
  ExecutionEnvironmentProvider,
  ExecutionEnvironmentRequest,
  ExecutionEnvironmentStatus,
} from "./types.js";

export interface HttpEnvironmentFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export type HttpEnvironmentFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<HttpEnvironmentFetchResponse>;

export type HttpEnvironmentPath =
  | string
  | ((environment: ExecutionEnvironment) => string);

export interface HttpExecutionEnvironmentProviderOptions {
  baseUrl: string;
  provider?: string;
  token?: string;
  headers?: Record<string, string>;
  provisionPath?: string;
  releasePath?: HttpEnvironmentPath;
  healthPath?: HttpEnvironmentPath;
  image?: string;
  defaultSize?: EnvironmentSize;
  fetch?: HttpEnvironmentFetch;
  clock?: () => Date;
}

export type CerebroExecutionEnvironmentProviderOptions =
  Omit<HttpExecutionEnvironmentProviderOptions, "provider">;

type ProvisionBody = {
  sessionId: string;
  task: {
    id?: string;
    title: string;
    repo?: unknown;
    scope?: unknown;
    metadata?: Record<string, unknown>;
  };
  trigger: {
    kind: string;
    source: string;
    actor?: string;
    correlationId?: string;
  };
  route: {
    agentId: string;
    runtime?: string;
    provider?: string;
    model?: string;
    mode?: string;
    priority?: string;
    environmentSize?: string;
    requiredTools?: string[];
    metadata?: Record<string, unknown>;
  };
  size: EnvironmentSize;
  image?: string;
};

const DEFAULT_PROVISION_PATH = "/environments";
const DEFAULT_RELEASE_PATH = "/environments/{id}/release";
const DEFAULT_HEALTH_PATH = "/environments/{id}/health";
const STATUSES = new Set<ExecutionEnvironmentStatus>([
  "provisioning",
  "ready",
  "unhealthy",
  "released",
]);
const SIZES = new Set<EnvironmentSize>(["small", "medium", "large", "xlarge"]);

function nowIso(clock: () => Date): string {
  return clock().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function statusField(record: Record<string, unknown>): ExecutionEnvironmentStatus | undefined {
  const status = stringField(record, "status");
  return status && STATUSES.has(status as ExecutionEnvironmentStatus)
    ? status as ExecutionEnvironmentStatus
    : undefined;
}

function sizeField(record: Record<string, unknown>): EnvironmentSize | undefined {
  const size = stringField(record, "size", "environmentSize", "environment_size");
  return size && SIZES.has(size as EnvironmentSize) ? size as EnvironmentSize : undefined;
}

function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid HTTP environment base URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("HTTP environment base URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("HTTP environment base URL must not include credentials.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function assertPath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`HTTP environment path must start with "/": ${path}`);
  }
  if (/^\/\//.test(path) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    throw new Error(`HTTP environment path must be relative to baseUrl: ${path}`);
  }
  return path;
}

function formatPath(path: HttpEnvironmentPath, environment: ExecutionEnvironment): string {
  const raw = typeof path === "function" ? path(environment) : path;
  return assertPath(raw.replace("{id}", encodeURIComponent(environment.id)));
}

function makeUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${assertPath(path)}`;
}

function defaultFetch(): HttpEnvironmentFetch {
  if (typeof fetch !== "function") {
    throw new Error("HTTP environment provider requires global fetch or options.fetch.");
  }
  return (url, init) => fetch(url, init) as Promise<HttpEnvironmentFetchResponse>;
}

function requestHeaders(options: HttpExecutionEnvironmentProviderOptions): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(options.headers ?? {}),
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };
}

function sanitizeHttpError(method: string, path: string, response: HttpEnvironmentFetchResponse): Error {
  return new Error(
    `HTTP environment provider request failed: ${method} ${path} returned ${response.status} ${response.statusText}`,
  );
}

function compactProvisionBody(
  request: ExecutionEnvironmentRequest,
  size: EnvironmentSize,
  image: string | undefined,
): ProvisionBody {
  return {
    sessionId: request.sessionId,
    task: {
      id: request.task.id,
      title: request.task.title,
      repo: request.task.repo,
      scope: request.task.scope,
      metadata: request.task.metadata,
    },
    trigger: {
      kind: request.trigger.kind,
      source: request.trigger.source,
      actor: request.trigger.actor,
      correlationId: request.trigger.correlationId,
    },
    route: {
      agentId: request.route.agentId,
      runtime: request.route.runtime,
      provider: request.route.provider,
      model: request.route.model,
      mode: request.route.mode,
      priority: request.route.priority,
      environmentSize: request.route.environmentSize,
      requiredTools: request.route.requiredTools,
      metadata: request.route.metadata,
    },
    size,
    image,
  };
}

function responseRecord(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  return recordField(body, "environment") ?? body;
}

export class HttpExecutionEnvironmentProvider implements ExecutionEnvironmentProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: HttpEnvironmentFetch;
  private readonly clock: () => Date;

  constructor(private readonly options: HttpExecutionEnvironmentProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? defaultFetch();
    this.clock = options.clock ?? (() => new Date());
    assertPath(options.provisionPath ?? DEFAULT_PROVISION_PATH);
    assertPath(typeof options.releasePath === "string" ? options.releasePath : DEFAULT_RELEASE_PATH);
    assertPath(typeof options.healthPath === "string" ? options.healthPath : DEFAULT_HEALTH_PATH);
  }

  async provision(request: ExecutionEnvironmentRequest): Promise<ExecutionEnvironment> {
    const size = request.route.environmentSize ?? this.options.defaultSize ?? "small";
    const image = request.route.metadata?.image && typeof request.route.metadata.image === "string"
      ? request.route.metadata.image
      : this.options.image;
    const path = this.options.provisionPath ?? DEFAULT_PROVISION_PATH;
    const response = await this.fetchImpl(makeUrl(this.baseUrl, path), {
      method: "POST",
      headers: requestHeaders(this.options),
      body: JSON.stringify(compactProvisionBody(request, size, image)),
    });
    if (!response.ok) throw sanitizeHttpError("POST", path, response);

    const record = responseRecord(await response.json());
    const timestamp = nowIso(this.clock);
    const id = stringField(record, "id", "environmentId", "environment_id");
    if (!id) {
      throw new Error("HTTP environment provision response missing id.");
    }

    return {
      id,
      provider: this.options.provider ?? stringField(record, "provider") ?? "http-devbox",
      status: statusField(record) ?? "ready",
      size: sizeField(record) ?? size,
      workspaceDir: stringField(record, "workspaceDir", "workspace_dir"),
      image: stringField(record, "image") ?? image,
      createdAt: stringField(record, "createdAt", "created_at") ?? timestamp,
      updatedAt: stringField(record, "updatedAt", "updated_at") ?? timestamp,
      metadata: {
        taskId: request.task.id,
        remoteUrl: stringField(record, "url", "uri"),
        remoteProvider: stringField(record, "provider"),
        responseKeys: Object.keys(record).sort(),
      },
    };
  }

  async release(environment: ExecutionEnvironment, reason: string): Promise<void> {
    const path = formatPath(this.options.releasePath ?? DEFAULT_RELEASE_PATH, environment);
    const response = await this.fetchImpl(makeUrl(this.baseUrl, path), {
      method: "POST",
      headers: requestHeaders(this.options),
      body: JSON.stringify({ environmentId: environment.id, reason }),
    });
    if (!response.ok) throw sanitizeHttpError("POST", path, response);
  }

  async health(environment: ExecutionEnvironment): Promise<boolean> {
    const path = formatPath(this.options.healthPath ?? DEFAULT_HEALTH_PATH, environment);
    const response = await this.fetchImpl(makeUrl(this.baseUrl, path), {
      method: "GET",
      headers: requestHeaders(this.options),
    });
    if (!response.ok) return false;
    const body = await response.json();
    const record = responseRecord(body);
    const healthy = record.healthy ?? record.ok;
    if (typeof healthy === "boolean") return healthy;
    const status = statusField(record);
    return status === "ready";
  }
}

export class CerebroExecutionEnvironmentProvider extends HttpExecutionEnvironmentProvider {
  constructor(options: CerebroExecutionEnvironmentProviderOptions) {
    super({
      provider: "cerebro",
      provisionPath: "/api/environments",
      releasePath: "/api/environments/{id}/release",
      healthPath: "/api/environments/{id}/health",
      ...options,
    });
  }
}
