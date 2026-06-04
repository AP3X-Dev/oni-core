// ============================================================
// @oni.bot/core CLI - platform-smoke command
// ============================================================
// Local end-to-end smoke for the background-agent platform:
// trigger -> session -> environment -> identity/capabilities ->
// external-agent runner -> durable artifact/session stores.
// ============================================================

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ExternalAgentDriver,
  ExternalAgentEventSink,
  ExternalAgentRunRequest,
  ExternalAgentRunResult,
} from "../harness/external-agent.js";
import {
  BackgroundAgentPlatform,
  JsonFileAgentSessionStore,
  JsonFileArtifactStore,
  LocalExecutionEnvironmentProvider,
  StaticAgentRouter,
  createCliTrigger,
  createExternalAgentSessionRunner,
} from "../platform/index.js";
import type {
  AgentSession,
  TaskSpec,
} from "../platform/index.js";
import type { ParsedArgs } from "./router.js";

export interface PlatformSmokeOptions {
  rootDir?: string;
  title?: string;
  goal?: string;
  actor?: string;
  command?: string;
  argv?: string[];
  flags?: Record<string, string>;
  cwd?: string;
}

export interface PlatformSmokeResult {
  rootDir: string;
  sessionFile: string;
  artifactFile: string;
  workspaceRoot: string;
  session: AgentSession;
}

function smokeCapabilities() {
  return {
    structuredMessages: false,
    toolSchemas: false,
    tokenStreaming: false,
    reasoningText: false,
    reasoningEncrypted: false,
    toolCallEvents: false,
    diffStreaming: false,
    workspaceWrites: false,
  };
}

function createSmokeDriver(): ExternalAgentDriver {
  return {
    provider: "smoke",
    name: "platform-smoke-driver",
    capabilities: smokeCapabilities(),
    async run(
      request: ExternalAgentRunRequest,
      emit: ExternalAgentEventSink,
    ): Promise<ExternalAgentRunResult> {
      const startedAt = Date.now();
      emit({
        type: "external_agent_artifact",
        agentId: request.agentId,
        provider: request.provider,
        mode: request.mode,
        timestamp: Date.now(),
        content: [
          "Platform smoke completed.",
          `agentId=${request.agentId}`,
          `cwd=${request.cwd ?? ""}`,
          `mergePolicy=${request.mergePolicy ?? "manual"}`,
        ].join("\n"),
      });

      return {
        agentId: request.agentId,
        provider: request.provider,
        mode: request.mode,
        status: "completed",
        output: "Platform smoke completed.",
        startedAt,
        endedAt: Date.now(),
        events: [],
      };
    },
  };
}

function smokeTask(options: PlatformSmokeOptions): TaskSpec {
  return {
    title: options.title ?? "Platform smoke session",
    goal: options.goal ?? "Verify local background-agent platform primitives end to end.",
    scope: {
      allowedPaths: ["."],
      disallowedPaths: [],
      allowedCommands: [],
      network: "none",
    },
    allowedActions: ["read", "artifact"],
    successCriteria: [
      "A durable session record is written.",
      "A local workspace environment is provisioned.",
      "A reviewable artifact is persisted.",
    ],
    outputFormat: "report",
  };
}

export async function runPlatformSmoke(
  options: PlatformSmokeOptions = {},
): Promise<PlatformSmokeResult> {
  const rootDir = resolve(options.rootDir ?? ".oni/platform-smoke");
  const stateDir = join(rootDir, "state");
  const workspaceRoot = join(rootDir, "workspaces");
  const sessionFile = join(stateDir, "sessions.json");
  const artifactFile = join(stateDir, "artifacts.json");

  await mkdir(rootDir, { recursive: true });

  const platform = new BackgroundAgentPlatform({
    router: new StaticAgentRouter({
      agentId: "platform-smoke-worker",
      provider: "smoke",
      runtime: "local",
      mode: "conductor",
      priority: "normal",
      environmentSize: "small",
    }),
    runner: createExternalAgentSessionRunner({
      driver: createSmokeDriver(),
    }),
    environmentProvider: new LocalExecutionEnvironmentProvider({
      workspaceRoot,
    }),
    sessionStore: new JsonFileAgentSessionStore(sessionFile),
    artifactStore: new JsonFileArtifactStore(artifactFile),
  });

  const trigger = createCliTrigger({
    command: options.command ?? "platform-smoke",
    argv: options.argv ?? ["platform-smoke"],
    flags: options.flags,
    cwd: options.cwd ?? process.cwd(),
    actor: options.actor,
    source: "oni-cli",
  });

  const session = await platform.runTask({
    task: smokeTask(options),
    trigger,
  });

  return {
    rootDir,
    sessionFile,
    artifactFile,
    workspaceRoot,
    session,
  };
}

function printableResult(result: PlatformSmokeResult): Record<string, unknown> {
  return {
    sessionId: result.session.id,
    status: result.session.status,
    artifactCount: result.session.artifacts.length,
    rootDir: result.rootDir,
    sessionFile: result.sessionFile,
    artifactFile: result.artifactFile,
    workspaceDir: result.session.environment?.workspaceDir,
  };
}

export async function platformSmokeCommand(args: ParsedArgs): Promise<void> {
  const result = await runPlatformSmoke({
    rootDir: args.flags.dir,
    title: args.flags.title,
    goal: args.flags.goal,
    actor: args.flags.actor,
    command: args.command,
    argv: [args.command, ...args.positional],
    flags: args.flags,
    cwd: process.cwd(),
  });

  const summary = printableResult(result);
  if (args.flags.json === "true") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("\n  ONI Platform Smoke");
    console.log(`  Status: ${summary.status}`);
    console.log(`  Session: ${summary.sessionId}`);
    console.log(`  Artifacts: ${summary.artifactCount}`);
    console.log(`  State: ${summary.sessionFile}`);
    console.log(`  Workspace: ${summary.workspaceDir}`);
  }

  if (result.session.status !== "completed") {
    process.exitCode = 1;
  }
}
