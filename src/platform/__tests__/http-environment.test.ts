import { describe, expect, it } from "vitest";
import {
  BackgroundAgentPlatform,
  CerebroExecutionEnvironmentProvider,
  HttpExecutionEnvironmentProvider,
  StaticAgentRouter,
  type ExecutionEnvironment,
  type ExecutionEnvironmentRequest,
  type HttpEnvironmentFetch,
  type HttpEnvironmentFetchResponse,
  type TaskSpec,
} from "../index.js";

type FetchCall = {
  url: string;
  init: Parameters<HttpEnvironmentFetch>[1];
};

function jsonResponse(
  body: unknown,
  options: Partial<Pick<HttpEnvironmentFetchResponse, "ok" | "status" | "statusText">> = {},
): HttpEnvironmentFetchResponse {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    async json() {
      return body;
    },
  };
}

function fetchSequence(responses: HttpEnvironmentFetchResponse[]): {
  calls: FetchCall[];
  fetch: HttpEnvironmentFetch;
} {
  const calls: FetchCall[] = [];
  return {
    calls,
    async fetch(url, init) {
      calls.push({ url, init });
      const response = responses.shift();
      if (!response) throw new Error(`Unexpected fetch call: ${url}`);
      return response;
    },
  };
}

function task(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task_1",
    title: "Provision remote devbox",
    goal: "Provision a governed remote workspace.",
    repo: {
      provider: "github",
      owner: "oni",
      name: "core",
      ref: "main",
    },
    scope: {
      allowedPaths: ["src"],
      network: "restricted",
    },
    successCriteria: ["Remote workspace is ready."],
    metadata: { ticket: "OPS-1" },
    ...overrides,
  };
}

function request(): ExecutionEnvironmentRequest {
  return {
    sessionId: "ses_123",
    task: task(),
    trigger: {
      id: "trg_1",
      kind: "vcs",
      source: "github.pull_request",
      actor: "octocat",
      correlationId: "delivery_1",
      firedAt: "2026-05-23T00:00:00.000Z",
    },
    route: {
      agentId: "codex-worker",
      runtime: "codex",
      provider: "codex",
      model: "gpt-5",
      mode: "conductor",
      priority: "high",
      environmentSize: "medium",
      requiredTools: ["git", "pnpm"],
      metadata: {
        image: "node:20",
        requestId: "route_1",
      },
    },
  };
}

function environment(overrides: Partial<ExecutionEnvironment> = {}): ExecutionEnvironment {
  return {
    id: "env_1",
    provider: "http-devbox",
    status: "ready",
    size: "medium",
    workspaceDir: "/workspace/ses_123",
    image: "node:20",
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("HTTP execution environment provider", () => {
  it("provisions through a compact authenticated HTTP request", async () => {
    const { calls, fetch } = fetchSequence([
      jsonResponse({
        id: "env_remote",
        provider: "devbox",
        status: "ready",
        workspaceDir: "/remote/workspace",
        url: "https://devbox.example/env/env_remote",
      }, { status: 201, statusText: "Created" }),
    ]);
    const provider = new HttpExecutionEnvironmentProvider({
      baseUrl: "https://devbox.example/api/",
      token: "secret_token",
      headers: { "x-project": "oni" },
      fetch,
      clock: () => new Date("2026-05-23T12:00:00.000Z"),
    });

    const provisioned = await provider.provision(request());

    expect(provisioned).toMatchObject({
      id: "env_remote",
      provider: "devbox",
      status: "ready",
      size: "medium",
      workspaceDir: "/remote/workspace",
      image: "node:20",
      createdAt: "2026-05-23T12:00:00.000Z",
      updatedAt: "2026-05-23T12:00:00.000Z",
      metadata: {
        taskId: "task_1",
        remoteUrl: "https://devbox.example/env/env_remote",
        remoteProvider: "devbox",
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://devbox.example/api/environments",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-project": "oni",
          authorization: "Bearer secret_token",
        },
      },
    });
    const body = JSON.parse(calls[0]!.init.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      sessionId: "ses_123",
      size: "medium",
      image: "node:20",
      task: {
        id: "task_1",
        title: "Provision remote devbox",
        metadata: { ticket: "OPS-1" },
      },
      trigger: {
        kind: "vcs",
        source: "github.pull_request",
        actor: "octocat",
        correlationId: "delivery_1",
      },
      route: {
        agentId: "codex-worker",
        runtime: "codex",
        provider: "codex",
        requiredTools: ["git", "pnpm"],
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret_token");
    expect(body).not.toHaveProperty("goal");
    expect(body).not.toHaveProperty("successCriteria");
  });

  it("maps nested provision responses and snake_case fields", async () => {
    const { fetch } = fetchSequence([
      jsonResponse({
        environment: {
          environment_id: "env_nested",
          status: "provisioning",
          environment_size: "xlarge",
          workspace_dir: "/workspace/nested",
          image: "custom:latest",
          created_at: "2026-05-23T01:00:00.000Z",
          updated_at: "2026-05-23T01:00:01.000Z",
          uri: "https://cerebro.example/env/env_nested",
        },
      }),
    ]);
    const provider = new HttpExecutionEnvironmentProvider({
      baseUrl: "https://cerebro.example",
      defaultSize: "large",
      image: "fallback:latest",
      fetch,
    });

    await expect(provider.provision(request())).resolves.toMatchObject({
      id: "env_nested",
      provider: "http-devbox",
      status: "provisioning",
      size: "xlarge",
      workspaceDir: "/workspace/nested",
      image: "custom:latest",
      createdAt: "2026-05-23T01:00:00.000Z",
      updatedAt: "2026-05-23T01:00:01.000Z",
      metadata: {
        remoteUrl: "https://cerebro.example/env/env_nested",
      },
    });
  });

  it("releases and health-checks environments without leaking response bodies", async () => {
    const { calls, fetch } = fetchSequence([
      jsonResponse({ ok: true }),
      jsonResponse({ status: "ready" }),
      jsonResponse({ error: "secret_token leaked in body" }, {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    ]);
    const provider = new HttpExecutionEnvironmentProvider({
      baseUrl: "https://devbox.example",
      token: "secret_token",
      fetch,
    });

    await provider.release(environment({ id: "env with spaces" }), "agent run finished");
    await expect(provider.health(environment({ id: "env with spaces" }))).resolves.toBe(true);
    let releaseError: unknown;
    try {
      await provider.release(environment({ id: "env_failed" }), "cleanup");
    } catch (error) {
      releaseError = error;
    }
    expect(releaseError).toBeInstanceOf(Error);
    expect((releaseError as Error).message).toContain(
      "POST /environments/env_failed/release returned 500 Internal Server Error",
    );
    expect((releaseError as Error).message).not.toContain("secret_token");
    expect((releaseError as Error).message).not.toContain("leaked in body");

    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "POST https://devbox.example/environments/env%20with%20spaces/release",
      "GET https://devbox.example/environments/env%20with%20spaces/health",
      "POST https://devbox.example/environments/env_failed/release",
    ]);
    expect(JSON.parse(calls[0]!.init.body ?? "{}")).toEqual({
      environmentId: "env with spaces",
      reason: "agent run finished",
    });
  });

  it("fails closed for invalid provision responses", async () => {
    const { fetch } = fetchSequence([jsonResponse({ status: "ready" })]);
    const provider = new HttpExecutionEnvironmentProvider({
      baseUrl: "https://devbox.example",
      fetch,
    });

    await expect(provider.provision(request())).rejects.toThrow(
      "HTTP environment provision response missing id",
    );
  });

  it("returns false for unhealthy or unavailable health responses", async () => {
    const { fetch } = fetchSequence([
      jsonResponse({ healthy: false }),
      jsonResponse({ status: "unhealthy" }),
      jsonResponse({ error: "down" }, { ok: false, status: 503, statusText: "Unavailable" }),
    ]);
    const provider = new HttpExecutionEnvironmentProvider({
      baseUrl: "https://devbox.example",
      fetch,
    });

    await expect(provider.health(environment())).resolves.toBe(false);
    await expect(provider.health(environment())).resolves.toBe(false);
    await expect(provider.health(environment())).resolves.toBe(false);
  });

  it("rejects unsafe base URLs and paths", () => {
    const fetch = fetchSequence([]).fetch;

    expect(() => new HttpExecutionEnvironmentProvider({
      baseUrl: "file:///tmp/devbox",
      fetch,
    })).toThrow("base URL must use http or https");
    expect(() => new HttpExecutionEnvironmentProvider({
      baseUrl: "https://user:pass@devbox.example",
      fetch,
    })).toThrow("base URL must not include credentials");
    expect(() => new HttpExecutionEnvironmentProvider({
      baseUrl: "https://devbox.example",
      provisionPath: "https://evil.example/environments",
      fetch,
    })).toThrow('path must start with "/"');
    expect(() => new HttpExecutionEnvironmentProvider({
      baseUrl: "https://devbox.example",
      healthPath: "//evil.example/health",
      fetch,
    })).toThrow("path must be relative to baseUrl");
  });

  it("uses Cerebro default API routes", async () => {
    const { calls, fetch } = fetchSequence([
      jsonResponse({ id: "env_cerebro", workspaceDir: "/cerebro/workspace" }),
      jsonResponse({ ok: true }),
      jsonResponse({ healthy: true }),
    ]);
    const provider = new CerebroExecutionEnvironmentProvider({
      baseUrl: "https://cerebro.example",
      token: "cerebro_token",
      fetch,
    });

    await expect(provider.provision(request())).resolves.toMatchObject({
      id: "env_cerebro",
      provider: "cerebro",
      workspaceDir: "/cerebro/workspace",
    });
    await provider.release(environment({ id: "env_cerebro" }), "done");
    await expect(provider.health(environment({ id: "env_cerebro" }))).resolves.toBe(true);

    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "POST https://cerebro.example/api/environments",
      "POST https://cerebro.example/api/environments/env_cerebro/release",
      "GET https://cerebro.example/api/environments/env_cerebro/health",
    ]);
  });

  it("can provision a full platform session through HTTP environment provider", async () => {
    const { fetch } = fetchSequence([
      jsonResponse({
        id: "env_platform",
        provider: "devbox",
        status: "ready",
        workspaceDir: "/remote/platform-workspace",
      }),
      jsonResponse({ ok: true }),
    ]);
    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "remote-worker", runtime: "codex" }),
      runner: {
        async run(request) {
          return {
            summary: `ran in ${request.environment.workspaceDir}`,
            artifacts: [{
              type: "report",
              title: "Remote run",
              content: request.environment.id,
            }],
          };
        },
      },
      environmentProvider: new HttpExecutionEnvironmentProvider({
        baseUrl: "https://devbox.example",
        fetch,
      }),
    });

    const completed = await platform.runTask({ task: task() });

    expect(completed.status).toBe("completed");
    expect(completed.environment).toMatchObject({
      id: "env_platform",
      status: "released",
      workspaceDir: "/remote/platform-workspace",
    });
    expect(completed.result).toBe("ran in /remote/platform-workspace");
    expect(completed.audit.map((event) => event.type)).toEqual(expect.arrayContaining([
      "environment.provisioned",
      "environment.released",
      "artifact.created",
    ]));
  });
});
