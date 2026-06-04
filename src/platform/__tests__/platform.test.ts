import { describe, it, expect } from "vitest";
import {
  BackgroundAgentPlatform,
  InMemoryReviewGate,
  StaticAgentRouter,
} from "../index.js";
import type {
  AgentRunRequest,
  AgentSessionRunner,
  PlatformLogRecord,
  TaskSpec,
} from "../index.js";
import type { SpanLike, TracerLike } from "../../telemetry.js";

class TestSpan implements SpanLike {
  readonly attributes = new Map<string, unknown>();
  status?: { code: number; message?: string };
  exceptions: Error[] = [];
  ended = false;

  constructor(readonly name: string) {}

  setAttribute(key: string, value: unknown): this {
    this.attributes.set(key, value);
    return this;
  }

  setStatus(status: { code: number; message?: string }): this {
    this.status = status;
    return this;
  }

  recordException(err: Error): void {
    this.exceptions.push(err);
  }

  end(): void {
    this.ended = true;
  }
}

function task(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    title: "Patch auth flow",
    goal: "Fix the auth callback regression and verify the login path.",
    repo: {
      provider: "github",
      owner: "ap3x",
      name: "app",
      baseBranch: "main",
      workBranch: "agent/auth-fix",
    },
    scope: {
      allowedPaths: ["src/auth"],
      allowedCommands: ["pnpm test"],
      connectors: ["github"],
      network: "restricted",
    },
    allowedActions: ["read", "write", "test", "vcs"],
    successCriteria: [
      "Auth callback preserves the intended redirect.",
      "Regression test passes.",
    ],
    ...overrides,
  };
}

describe("BackgroundAgentPlatform", () => {
  it("turns a trigger plus task spec into a governed completed session", async () => {
    const runner: AgentSessionRunner = {
      async run(request: AgentRunRequest) {
        expect(request.environment.status).toBe("ready");
        expect(request.identity.scopes).toContain("write");
        expect(request.capabilityGrant.capabilities.some((capability) => capability.name === "github")).toBe(true);
        return {
          summary: "Changed auth callback and verified regression test.",
          artifacts: [{
            type: "patch",
            title: "Auth callback patch",
            content: "diff --git a/src/auth/callback.ts b/src/auth/callback.ts",
          }],
          telemetry: {
            inputTokens: 100,
            outputTokens: 40,
            costUsd: 0.02,
          },
        };
      },
    };

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({
        agentId: "codex-worker",
        runtime: "codex",
        provider: "codex",
        priority: "high",
        environmentSize: "medium",
        requiredTools: ["git", "pnpm"],
      }),
      runner,
      capacity: { maxConcurrentSessions: 1 },
    });

    const session = await platform.runTask({
      task: task(),
      trigger: {
        kind: "vcs",
        source: "github.pull_request",
        actor: "cj",
      },
    });

    expect(session.status).toBe("completed");
    expect(session.priority).toBe("high");
    expect(session.route?.runtime).toBe("codex");
    expect(session.environment?.status).toBe("released");
    expect(session.identity?.revokedAt).toBeTruthy();
    expect(session.capabilityGrant?.status).toBe("revoked");
    expect(session.artifacts[0]?.type).toBe("patch");
    expect(session.result).toContain("Changed auth callback");
    expect(session.audit.map((event) => event.type)).toEqual([
      "session.created",
      "session.queued",
      "session.routed",
      "environment.provisioned",
      "identity.issued",
      "capability.granted",
      "session.running",
      "artifact.created",
      "capability.revoked",
      "identity.revoked",
      "environment.released",
      "session.completed",
    ]);

    const completed = await platform.listSessions({ status: "completed" });
    expect(completed.map((item) => item.id)).toEqual([session.id]);
  });

  it("emits structured logs and spans for platform lifecycle phases", async () => {
    const logs: PlatformLogRecord[] = [];
    const spans: TestSpan[] = [];
    const tracer: TracerLike = {
      startSpan(name: string) {
        const span = new TestSpan(name);
        spans.push(span);
        return span;
      },
    };
    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({
        agentId: "codex-worker",
        runtime: "codex",
        provider: "codex",
        requiredTools: ["git"],
      }),
      runner: {
        async run() {
          return {
            summary: "Completed with logs and spans.",
            artifacts: [{
              type: "report",
              title: "Run report",
              content: "ok",
            }],
          };
        },
      },
      logger: {
        log(record) {
          logs.push(record);
        },
      },
      tracer,
    });

    const session = await platform.runTask({ task: task() });
    const messages = logs.map((record) => record.message);
    const spanNames = spans.map((span) => span.name);
    const runnerSpan = spans.find((span) => span.name === "oni.platform.runner.execute");

    expect(session.status).toBe("completed");
    expect(messages).toEqual(expect.arrayContaining([
      "platform.routing.started",
      "platform.routing.completed",
      "platform.environment.provision.completed",
      "platform.identity.issue.completed",
      "platform.capability.grant.completed",
      "platform.runner.execute.completed",
      "platform.artifact.publish.completed",
      "platform.capability.revoke.completed",
      "platform.identity.revoke.completed",
      "platform.environment.release.completed",
      "platform.resource.release.completed",
    ]));
    expect(logs.every((record) => record.sessionId === session.id)).toBe(true);
    expect(spanNames).toEqual(expect.arrayContaining([
      "oni.platform.routing",
      "oni.platform.environment.provision",
      "oni.platform.identity.issue",
      "oni.platform.capability.grant",
      "oni.platform.runner.execute",
      "oni.platform.artifact.publish",
      "oni.platform.capability.revoke",
      "oni.platform.identity.revoke",
      "oni.platform.environment.release",
      "oni.platform.resource.release",
    ]));
    expect(spans.every((span) => span.ended)).toBe(true);
    expect(runnerSpan?.status?.code).toBe(1);
    expect(runnerSpan?.attributes.get("oni.agentId")).toBe("codex-worker");
  });

  it("keeps review-required output awaiting human approval", async () => {
    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "review-worker", runtime: "local" }),
      runner: {
        async run() {
          return { summary: "Prepared migration report." };
        },
      },
      reviewGate: new InMemoryReviewGate(),
    });

    const awaiting = await platform.runTask({
      task: task({
        review: {
          required: true,
          reviewers: ["lead"],
          artifactTypes: ["report"],
        },
      }),
    });

    expect(awaiting.status).toBe("awaiting_review");
    expect(awaiting.review?.status).toBe("pending");
    expect(awaiting.artifacts[0]?.type).toBe("report");
    expect(awaiting.environment?.status).toBe("released");

    const approved = await platform.submitReview(awaiting.id, {
      status: "approved",
      reviewer: "lead",
      notes: "Looks good.",
    });

    expect(approved.status).toBe("completed");
    expect(approved.review?.status).toBe("approved");
    expect(approved.audit.map((event) => event.type)).toContain("review.resolved");
  });

  it("queues sessions behind the configured concurrency limit", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "queued-worker", runtime: "local" }),
      runner: {
        async run(request) {
          started.push(request.session.id);
          if (started.length === 1) {
            firstStarted();
            await releaseFirstPromise;
          }
          return { summary: `Completed ${request.task.title}.` };
        },
      },
      capacity: { maxConcurrentSessions: 1 },
    });

    const first = await platform.submitTask({ task: task({ title: "First task" }) });
    await firstStartedPromise;

    const second = await platform.submitTask({ task: task({ title: "Second task" }) });
    expect((await platform.getSession(second.id))?.status).toBe("queued");

    releaseFirst();
    const [completedFirst, completedSecond] = await Promise.all([
      platform.waitForSession(first.id, { timeoutMs: 2_000 }),
      platform.waitForSession(second.id, { timeoutMs: 2_000 }),
    ]);

    expect(completedFirst.status).toBe("completed");
    expect(completedSecond.status).toBe("completed");
    expect(started).toEqual([first.id, second.id]);
  });

  it("cancels an active session through the runner abort signal", async () => {
    let observedAbort = false;
    const runner: AgentSessionRunner = {
      async run(request) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({ summary: "too late" });
          }, 10_000);
          request.signal?.addEventListener("abort", () => {
            observedAbort = true;
            clearTimeout(timer);
            reject(new Error("runner aborted"));
          }, { once: true });
        });
      },
    };
    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "slow-worker", timeoutMs: 60_000 }),
      runner,
    });

    const submitted = await platform.submitTask({ task: task() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await platform.cancelSession(submitted.id);
    const final = await platform.waitForSession(submitted.id, { timeoutMs: 2_000 });

    expect(observedAbort).toBe(true);
    expect(final.status).toBe("cancelled");
    expect(final.audit.map((event) => event.type)).toContain("session.cancelled");
  });
});
