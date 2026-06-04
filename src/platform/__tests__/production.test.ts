import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type {
  CapabilityGrant,
  TaskSpec,
} from "../index.js";
import type {
  ToolContext,
  ToolDefinition,
} from "../../tools/index.js";
import type { BaseSwarmState } from "../../swarm/index.js";
import { quickAgent } from "../../swarm/index.js";
import type {
  ExternalAgentDriver,
  ExternalAgentEvent,
  ExternalAgentRunRequest,
} from "../../harness/external-agent.js";
import { createCliExternalAgentDriver } from "../../harness/external-agent.js";
import type {
  ChatResponse,
  ONIModel,
} from "../../models/types.js";
import {
  BackgroundAgentPlatform,
  JsonFileAgentSessionStore,
  JsonFileArtifactStore,
  LocalExecutionEnvironmentProvider,
  StaticAgentRouter,
  createAgentLoopSessionRunner,
  createCliTrigger,
  createExternalAgentSessionRunner,
  createRuntimePolicyFromParts,
  createScheduledTrigger,
  createSwarmSessionRunner,
  wrapToolWithRuntimePolicy,
} from "../index.js";

function task(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    title: "Harden platform runner",
    goal: "Run a scoped background agent task and produce a reviewable artifact.",
    scope: {
      allowedPaths: ["src"],
      disallowedPaths: ["src/private"],
      allowedCommands: ["pnpm test"],
      secrets: ["API_TOKEN"],
      network: "none",
    },
    successCriteria: ["The runner enforces task scope."],
    allowedActions: ["read", "write", "test"],
    ...overrides,
  };
}

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: "cap_test",
    sessionId: "ses_test",
    identityId: "idn_test",
    status: "active",
    issuedAt: "2026-05-23T00:00:00.000Z",
    capabilities: [
      { name: "pnpm test", type: "command" },
      { name: "API_TOKEN", type: "secret" },
    ],
    ...overrides,
  };
}

const toolContext: ToolContext = {
  config: {} as ToolContext["config"],
  store: null,
  state: {},
  emit: () => undefined,
};

function mockModel(chat: () => Promise<ChatResponse> | ChatResponse): ONIModel {
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: {
      tools: true,
      vision: false,
      streaming: false,
      embeddings: false,
    },
    chat,
    async *stream() {
      // No streaming path needed for agentLoop runner tests.
    },
  };
}

describe("production platform hardening", () => {
  it("normalizes CLI and scheduled trigger payloads", () => {
    let idCount = 0;
    const options = {
      clock: () => new Date("2026-05-23T12:00:00.000Z"),
      idFactory: (prefix: string) => `${prefix}_${++idCount}`,
    };

    const cliTrigger = createCliTrigger({
      command: "platform-smoke",
      argv: ["platform-smoke", "--dir", ".oni/platform-smoke"],
      flags: { dir: ".oni/platform-smoke" },
      cwd: "C:/repo",
      actor: "developer",
    }, options);
    const scheduledTrigger = createScheduledTrigger({
      scheduleId: "nightly-hardening",
      scheduledFor: new Date("2026-05-24T03:00:00.000Z"),
      timezone: "America/Phoenix",
    }, options);

    expect(cliTrigger).toMatchObject({
      id: "trg_1",
      kind: "manual",
      source: "cli",
      actor: "developer",
      firedAt: "2026-05-23T12:00:00.000Z",
      payload: {
        command: "platform-smoke",
        cwd: "C:/repo",
        flags: { dir: ".oni/platform-smoke" },
      },
    });
    expect(scheduledTrigger).toMatchObject({
      id: "trg_2",
      kind: "schedule",
      source: "schedule:nightly-hardening",
      actor: "scheduler",
      payload: {
        scheduleId: "nightly-hardening",
        scheduledFor: "2026-05-24T03:00:00.000Z",
        timezone: "America/Phoenix",
      },
    });
  });

  it("persists sessions and artifacts across JSON file store instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-platform-store-"));
    const sessionFile = join(root, "sessions.json");
    const artifactFile = join(root, "artifacts.json");

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "local-worker", runtime: "local" }),
      runner: {
        async run() {
          return {
            summary: "Durable run complete.",
            artifacts: [{
              type: "report",
              title: "Durable report",
              content: "Saved to durable artifact store.",
            }],
          };
        },
      },
      environmentProvider: new LocalExecutionEnvironmentProvider({
        workspaceRoot: join(root, "workspaces"),
      }),
      sessionStore: new JsonFileAgentSessionStore(sessionFile),
      artifactStore: new JsonFileArtifactStore(artifactFile),
    });

    const completed = await platform.runTask({ task: task() });
    const sessions = new JsonFileAgentSessionStore(sessionFile);
    const artifacts = new JsonFileArtifactStore(artifactFile);

    await expect(sessions.get(completed.id)).resolves.toMatchObject({
      id: completed.id,
      status: "completed",
      result: "Durable run complete.",
    });
    await expect(artifacts.list(completed.id)).resolves.toEqual([
      expect.objectContaining({
        type: "report",
        title: "Durable report",
      }),
    ]);
  });

  it("enforces path, command, network, and secret scope from capability grants", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oni-platform-policy-"));
    await mkdir(join(workspace, "src", "private"), { recursive: true });

    const policy = createRuntimePolicyFromParts({
      sessionId: "ses_test",
      task: task(),
      grant: grant(),
      workspaceDir: workspace,
    });

    expect(policy.assertPathAllowed("src/index.ts")).toContain("src");
    expect(() => policy.assertPathAllowed("src/private/key.ts")).toThrow("disallowed path");
    expect(() => policy.assertPathAllowed("../outside.ts")).toThrow("outside allowed paths");
    expect(() => policy.assertCommandAllowed("pnpm test")).not.toThrow();
    expect(() => policy.assertCommandAllowed("pnpm build")).toThrow("Command denied");
    expect(() => policy.assertNetworkAllowed()).toThrow("Network access denied");
    expect(policy.filterEnv({ API_TOKEN: "secret_value" })).toEqual({ API_TOKEN: "secret_value" });
    expect(() => policy.filterEnv({ OTHER_TOKEN: "secret_value" })).toThrow("Secret/env access denied");
    expect(() => createRuntimePolicyFromParts({
      sessionId: "ses_test",
      task: task({ scope: { allowedPaths: ["../outside"], network: "none" } }),
      grant: grant(),
      workspaceDir: workspace,
    })).toThrow("escapes workspace");
  });

  it("wraps tools with runtime path, command, and capability policy", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oni-platform-tool-policy-"));
    await mkdir(join(workspace, "src", "private"), { recursive: true });

    const baseGrant = grant();
    const policy = createRuntimePolicyFromParts({
      sessionId: "ses_test",
      task: task(),
      grant: grant({
        capabilities: [
          ...baseGrant.capabilities,
          { name: "read_file", type: "tool" },
          { name: "run_command", type: "tool" },
        ],
      }),
      workspaceDir: workspace,
    });

    let readCount = 0;
    let observedPath = "";
    const readTool: ToolDefinition<{ path: string }, string> = {
      name: "read_file",
      description: "Read a scoped file.",
      schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute(input) {
        readCount++;
        observedPath = input.path;
        return input.path;
      },
    };
    const commandTool: ToolDefinition<{ command: string }, string> = {
      name: "run_command",
      description: "Run a scoped command.",
      schema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
      execute(input) {
        return input.command;
      },
    };

    const wrappedRead = wrapToolWithRuntimePolicy(readTool, policy, { rewritePaths: true });
    const wrappedCommand = wrapToolWithRuntimePolicy(commandTool, policy);

    const allowedPath = await wrappedRead.execute({ path: "src/index.ts" }, toolContext);
    expect(allowedPath).toBe(observedPath);
    expect(allowedPath).toContain("src");
    expect(readCount).toBe(1);
    expect(wrappedCommand.execute({ command: "pnpm test" }, toolContext)).toBe("pnpm test");

    expect(() => wrappedRead.execute({ path: "src/private/key.ts" }, toolContext)).toThrow("disallowed path");
    expect(() => wrappedCommand.execute({ command: "pnpm build" }, toolContext)).toThrow("Command denied");
    expect(readCount).toBe(1);
  });

  it("bridges platform sessions to external agents with scoped ownership and secret redaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-platform-runner-"));
    let capturedRequest: ExternalAgentRunRequest | null = null;

    const driver: ExternalAgentDriver = {
      provider: "codex",
      capabilities: {
        structuredMessages: false,
        toolSchemas: false,
        tokenStreaming: false,
        reasoningText: false,
        reasoningEncrypted: true,
        toolCallEvents: true,
        diffStreaming: true,
        workspaceWrites: true,
      },
      async run(request, emit) {
        capturedRequest = request;
        emit({
          type: "external_agent_diff",
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          timestamp: Date.now(),
          path: "src/index.ts",
          content: "diff contains secret_value",
        });
        return {
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          status: "completed",
          output: "completed with secret_value",
          startedAt: 1,
          endedAt: 6,
          events: [],
        };
      },
    };

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({
        agentId: "codex-worker",
        provider: "codex",
        runtime: "codex",
        mode: "conductor",
      }),
      runner: createExternalAgentSessionRunner({
        driver,
        env: { API_TOKEN: "secret_value" },
        requiredCommands: ["pnpm test"],
      }),
      environmentProvider: new LocalExecutionEnvironmentProvider({
        workspaceRoot: join(root, "workspaces"),
      }),
    });

    const completed = await platform.runTask({ task: task() });
    const capabilityAudit = completed.audit.find((event) => event.type === "capability.granted");

    expect(completed.status).toBe("completed");
    expect(completed.result).toBe("completed with [REDACTED_SECRET]");
    expect(completed.artifacts[0]?.content).toBe("diff contains [REDACTED_SECRET]");
    expect(capabilityAudit?.data?.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "command", name: "pnpm test" }),
      expect.objectContaining({ type: "secret", name: "API_TOKEN" }),
    ]));
    expect(JSON.stringify(capabilityAudit?.data)).not.toContain("secret_value");
    expect(capturedRequest?.cwd).toBe(completed.environment?.workspaceDir);
    expect(capturedRequest?.env).toEqual({ API_TOKEN: "secret_value" });
    expect(capturedRequest?.ownership?.allowedPaths?.[0]).toContain("src");
    expect(capturedRequest?.ownership?.disallowedPaths?.[0]).toContain("private");
  });

  it("records policy denials before an external agent can start", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-platform-denial-"));
    let started = false;
    const driver: ExternalAgentDriver = {
      provider: "codex",
      capabilities: {
        structuredMessages: false,
        toolSchemas: false,
        tokenStreaming: false,
        reasoningText: false,
        reasoningEncrypted: false,
        toolCallEvents: false,
        diffStreaming: false,
        workspaceWrites: true,
      },
      async run(_request: ExternalAgentRunRequest) {
        started = true;
        throw new Error("should not start");
      },
    };

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "codex-worker", provider: "codex" }),
      runner: createExternalAgentSessionRunner({
        driver,
        env: { DENIED_TOKEN: "secret_value" },
      }),
      environmentProvider: new LocalExecutionEnvironmentProvider({
        workspaceRoot: join(root, "workspaces"),
      }),
    });

    const failed = await platform.runTask({ task: task() });

    expect(started).toBe(false);
    expect(failed.status).toBe("failed");
    expect(failed.audit.map((event) => event.type)).toContain("policy.denied");
    expect(failed.error).toContain("DENIED_TOKEN");

    const health = await platform.getHealthSnapshot();
    const audit = await platform.getAuditSummary();
    const denialOnly = await platform.getAuditSummary({
      sessionId: failed.id,
      type: "policy.denied",
    });

    expect(health.statusCounts.failed).toBe(1);
    expect(health.queueDepth).toBe(0);
    expect(health.activeSessions).toBe(0);
    expect(health.failureRate).toBe(1);
    expect(audit.policyDenials).toBe(1);
    expect(audit.sessionsWithPolicyDenials).toEqual([failed.id]);
    expect(denialOnly.totalEvents).toBe(1);
  });

  it("runs CLI external agents without inherited env and redacts granted secret values before events escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-platform-cli-env-"));
    const previousSecret = process.env.ONI_TEST_PLATFORM_UNGRANTED_SECRET;
    process.env.ONI_TEST_PLATFORM_UNGRANTED_SECRET = "outside-platform-secret";
    const observedEvents: ExternalAgentEvent[] = [];
    const script = [
      "const allowed = process.env.API_TOKEN ?? 'missing';",
      "const inherited = process.env.ONI_TEST_PLATFORM_UNGRANTED_SECRET ?? 'missing';",
      "console.log(JSON.stringify({ type: 'message', content: `allowed=${allowed}; inherited=${inherited}` }));",
      "console.error(`stderr allowed=${allowed}; inherited=${inherited}`);",
    ].join("\n");
    const driver = createCliExternalAgentDriver({
      provider: "test-cli",
      command: process.execPath,
      args: () => ["-e", script],
      stdin: "none",
      output: "jsonl",
    });

    try {
      const platform = new BackgroundAgentPlatform({
        router: new StaticAgentRouter({ agentId: "cli-worker", provider: "test-cli" }),
        runner: createExternalAgentSessionRunner({
          driver,
          env: {
            API_TOKEN: "allowed-platform-secret",
          },
          onEvent(event) {
            observedEvents.push(event);
          },
        }),
        environmentProvider: new LocalExecutionEnvironmentProvider({
          workspaceRoot: join(root, "workspaces"),
        }),
      });

      const completed = await platform.runTask({
        task: task({
          scope: {
            ...task().scope,
            allowedPaths: ["."],
          },
        }),
      });
      const observed = JSON.stringify(observedEvents);

      expect(completed.status).toBe("completed");
      expect(completed.result).toContain("allowed=[REDACTED_SECRET]");
      expect(completed.result).toContain("inherited=missing");
      expect(observed).not.toContain("allowed-platform-secret");
      expect(observed).not.toContain("outside-platform-secret");
      expect(JSON.stringify(completed.artifacts)).not.toContain("allowed-platform-secret");
      expect(JSON.stringify(completed.artifacts)).not.toContain("outside-platform-secret");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.ONI_TEST_PLATFORM_UNGRANTED_SECRET;
      } else {
        process.env.ONI_TEST_PLATFORM_UNGRANTED_SECRET = previousSecret;
      }
    }
  });

  it("adds failed-run diagnosis and resume metadata for failed external agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-platform-external-fail-"));
    const driver: ExternalAgentDriver = {
      provider: "codex",
      capabilities: {
        structuredMessages: false,
        toolSchemas: false,
        tokenStreaming: false,
        reasoningText: false,
        reasoningEncrypted: false,
        toolCallEvents: false,
        diffStreaming: false,
        workspaceWrites: true,
      },
      async run(request, emit) {
        emit({
          type: "external_agent_artifact",
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          timestamp: Date.now(),
          content: "partial provider report",
        });
        return {
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          status: "failed",
          output: "provider failed",
          error: "provider crashed",
          startedAt: 1,
          endedAt: 2,
          events: [],
          metadata: { rawProviderValue: "sensitive provider value" },
          resume: {
            providerSessionId: "codex-session-123",
            command: "codex exec resume codex-session-123",
            metadata: { tokenLikeValue: "sensitive resume value" },
          },
        };
      },
    };

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "codex-worker", provider: "codex" }),
      runner: createExternalAgentSessionRunner({ driver }),
      environmentProvider: new LocalExecutionEnvironmentProvider({
        workspaceRoot: join(root, "workspaces"),
      }),
    });

    const failed = await platform.runTask({ task: task() });
    const diagnosis = failed.artifacts.find((artifact) => artifact.type === "failed_run_diagnosis");

    expect(failed.status).toBe("failed");
    expect(failed.artifacts.map((artifact) => artifact.type)).toEqual(expect.arrayContaining([
      "report",
      "failed_run_diagnosis",
    ]));
    expect(diagnosis?.metadata?.resume).toEqual(expect.objectContaining({
      providerSessionId: "codex-session-123",
      command: "codex exec resume codex-session-123",
      metadataKeys: ["tokenLikeValue"],
    }));
    expect(diagnosis?.metadata?.providerMetadataKeys).toEqual(["rawProviderValue"]);
    expect(JSON.stringify(diagnosis?.metadata)).not.toContain("sensitive");
  });

  it("runs harness agentLoop sessions behind the platform runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-platform-agent-loop-"));
    const model = mockModel(() => ({
      content: "Agent loop completed the task.",
      usage: { inputTokens: 5, outputTokens: 7 },
      stopReason: "end",
    }));

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({
        agentId: "loop-worker",
        runtime: "agentLoop",
      }),
      runner: createAgentLoopSessionRunner({
        config: {
          model,
          tools: [],
          agentName: "loop-worker",
          systemPrompt: "Complete the task and report the result.",
          maxTurns: 1,
        },
      }),
      environmentProvider: new LocalExecutionEnvironmentProvider({
        workspaceRoot: join(root, "workspaces"),
      }),
    });

    const completed = await platform.runTask({ task: task() });

    expect(completed.status).toBe("completed");
    expect(completed.result).toBe("Agent loop completed the task.");
    expect(completed.artifacts[0]).toEqual(expect.objectContaining({
      type: "report",
      title: "Agent loop report",
      content: "Agent loop completed the task.",
    }));
    expect(completed.telemetry?.metadata).toEqual(expect.objectContaining({
      count: expect.any(Number),
      types: expect.objectContaining({ result: 1 }),
    }));
  });

  it("redacts granted secret values from agentLoop artifacts and result", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-platform-agent-loop-redact-"));
    const secret = "supersecretvalue123";
    const model = mockModel(() => ({
      content: `Finished. Used token=${secret} to authenticate.`,
      usage: { inputTokens: 5, outputTokens: 7 },
      stopReason: "end",
    }));

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "loop-worker", runtime: "agentLoop" }),
      runner: createAgentLoopSessionRunner({
        config: {
          model,
          tools: [],
          agentName: "loop-worker",
          systemPrompt: "Complete the task and report the result.",
          maxTurns: 1,
          // API_TOKEN is granted by the default task() scope.secrets.
          env: { API_TOKEN: secret },
        },
      }),
      environmentProvider: new LocalExecutionEnvironmentProvider({
        workspaceRoot: join(root, "workspaces"),
      }),
    });

    const completed = await platform.runTask({ task: task() });

    expect(completed.status).toBe("completed");
    expect(completed.result).not.toContain(secret);
    expect(completed.result).toContain("[REDACTED_SECRET]");
    expect(completed.artifacts[0]?.content).not.toContain(secret);
    expect(completed.artifacts[0]?.content).toContain("[REDACTED_SECRET]");
  });

  it("returns failed platform sessions when agentLoop inference fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-platform-agent-loop-fail-"));
    const model = mockModel(() => {
      throw new Error("model failed");
    });

    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({
        agentId: "loop-worker",
        runtime: "agentLoop",
      }),
      runner: createAgentLoopSessionRunner({
        config: {
          model,
          tools: [],
          agentName: "loop-worker",
          systemPrompt: "Complete the task and report the result.",
          maxTurns: 1,
        },
      }),
      environmentProvider: new LocalExecutionEnvironmentProvider({
        workspaceRoot: join(root, "workspaces"),
      }),
    });

    const failed = await platform.runTask({ task: task() });

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Inference error");
    expect(failed.artifacts[0]).toEqual(expect.objectContaining({
      type: "failed_run_diagnosis",
      title: "Agent loop failed run diagnosis",
    }));
  });

  it("runs swarm skeletons behind the platform runner", async () => {
    const agent = quickAgent("worker", (state: BaseSwarmState) => ({
      agentResults: {
        worker: `swarm completed: ${state.task}`,
      },
      done: true,
    }));
    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({
        agentId: "swarm-worker",
        runtime: "swarm",
      }),
      runner: createSwarmSessionRunner({
        swarm: agent.skeleton,
        summarize: (state) => String(state.agentResults.worker),
      }),
    });

    const completed = await platform.runTask({ task: task() });

    expect(completed.status).toBe("completed");
    expect(completed.result).toBe(`swarm completed: ${task().goal}`);
    expect(completed.artifacts[0]).toEqual(expect.objectContaining({
      type: "report",
      title: "Swarm run report",
      content: `swarm completed: ${task().goal}`,
    }));
    expect(completed.telemetry?.metadata).toEqual(expect.objectContaining({
      done: true,
      agentResultKeys: ["worker"],
    }));
  });

  it("returns failed platform sessions when swarm execution throws", async () => {
    const agent = quickAgent("worker", () => {
      throw new Error("swarm failed");
    });
    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({
        agentId: "swarm-worker",
        runtime: "swarm",
      }),
      runner: createSwarmSessionRunner({
        swarm: agent.skeleton,
      }),
    });

    const failed = await platform.runTask({ task: task() });

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("swarm failed");
    expect(failed.artifacts[0]).toEqual(expect.objectContaining({
      type: "failed_run_diagnosis",
      title: "Swarm failed run diagnosis",
    }));
  });
});
