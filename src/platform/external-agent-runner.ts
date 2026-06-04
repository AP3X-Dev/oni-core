// ============================================================
// @oni.bot/core/platform - External agent session runner
// ============================================================
// Bridges platform AgentSessionRunner to harness ExternalAgentDriver
// while applying task-scope policy before the CLI driver runs.
// ============================================================

import type {
  ExternalAgentDriver,
  ExternalAgentEvent,
  ExternalAgentMergePolicy,
  ExternalAgentMode,
  ExternalAgentResumeMetadata,
} from "../harness/external-agent.js";
import { runExternalAgent } from "../harness/external-agent.js";
import type {
  AgentRunOutcome,
  AgentRunRequest,
  AgentSessionRunner,
  OutputArtifactInput,
  TaskSpec,
} from "./types.js";
import { createRuntimePolicy } from "./policy.js";

export interface ExternalAgentSessionRunnerOptions {
  driver: ExternalAgentDriver;
  mode?: ExternalAgentMode;
  role?: string;
  systemPrompt?: string;
  mergePolicy?: ExternalAgentMergePolicy;
  env?: Record<string, string | undefined>;
  inheritProcessEnv?: boolean;
  requiredCommands?: string[];
  requiresNetwork?: boolean;
  onEvent?: (event: ExternalAgentEvent, request: AgentRunRequest) => void;
}

function taskPrompt(task: TaskSpec): string {
  return [
    task.title,
    "",
    "Goal:",
    task.goal,
    "",
    "Success criteria:",
    ...task.successCriteria.map((criterion) => `- ${criterion}`),
    task.constraints?.length ? "" : undefined,
    task.constraints?.length ? "Constraints:" : undefined,
    ...(task.constraints?.map((constraint) => `- ${constraint}`) ?? []),
    task.outputFormat ? "" : undefined,
    task.outputFormat ? `Output format: ${task.outputFormat}` : undefined,
  ].filter((line): line is string => line !== undefined).join("\n");
}

function routeMode(mode: string | undefined, fallback: ExternalAgentMode): ExternalAgentMode {
  return mode === "ide" || mode === "conductor" ? mode : fallback;
}

function redact(text: string, env: Record<string, string | undefined>): string {
  let out = text;
  for (const value of Object.values(env)) {
    if (!value || value.length < 4) continue;
    out = out.split(value).join("[REDACTED_SECRET]");
  }
  return out;
}

function artifactsFromEvents(
  events: ExternalAgentEvent[],
  env: Record<string, string | undefined>,
): OutputArtifactInput[] {
  const artifacts: OutputArtifactInput[] = [];
  for (const event of events) {
    if (!event.content) continue;
    if (event.type === "external_agent_diff") {
      artifacts.push({
        type: "patch",
        title: event.path ? `External agent diff: ${event.path}` : "External agent diff",
        content: redact(event.content, env),
        metadata: {
          provider: event.provider,
          agentId: event.agentId,
          path: event.path,
        },
      });
    }
    if (event.type === "external_agent_artifact") {
      artifacts.push({
        type: "report",
        title: "External agent artifact",
        content: redact(event.content, env),
        metadata: {
          provider: event.provider,
          agentId: event.agentId,
        },
      });
    }
  }
  return artifacts;
}

function failedRunDiagnosis(
  summary: string,
  result: {
    provider: string;
    agentId: string;
    mode: string;
    events: ExternalAgentEvent[];
    exitCode?: number | null;
    error?: string;
    resume?: ExternalAgentResumeMetadata;
    metadata?: Record<string, unknown>;
  },
): OutputArtifactInput {
  const resume = summarizeResumeMetadata(result.resume);
  return {
    type: "failed_run_diagnosis",
    title: "External agent failed run diagnosis",
    content: result.error ? `${summary}\n\n${result.error}` : summary,
    metadata: {
      provider: result.provider,
      agentId: result.agentId,
      mode: result.mode,
      eventCount: result.events.length,
      exitCode: result.exitCode,
      resume,
      providerMetadataKeys: result.metadata ? Object.keys(result.metadata).sort() : undefined,
    },
  };
}

function summarizeResumeMetadata(
  resume: ExternalAgentResumeMetadata | undefined,
): Record<string, unknown> | undefined {
  if (!resume) return undefined;
  return {
    providerSessionId: resume.providerSessionId,
    sessionId: resume.sessionId,
    command: resume.command,
    cwd: resume.cwd,
    metadataKeys: resume.metadata ? Object.keys(resume.metadata).sort() : undefined,
  };
}

export class ExternalAgentSessionRunner implements AgentSessionRunner {
  constructor(private readonly options: ExternalAgentSessionRunnerOptions) {}

  async run(request: AgentRunRequest): Promise<AgentRunOutcome> {
    const policy = createRuntimePolicy(request);
    policy.assertGrantActive();
    for (const command of this.options.requiredCommands ?? []) {
      policy.assertCommandAllowed(command);
    }
    if (this.options.requiresNetwork) {
      policy.assertNetworkAllowed();
    }

    if (!request.environment.workspaceDir) {
      throw new Error("External agent sessions require an execution environment workspaceDir.");
    }

    const env = policy.filterEnv(this.options.env ?? {});
    const redactValues = Object.values(env)
      .filter((value): value is string => typeof value === "string" && value.length >= 4);
    const events: ExternalAgentEvent[] = [];
    const result = await runExternalAgent(
      this.options.driver,
      {
        agentId: request.route.agentId,
        provider: this.options.driver.provider,
        mode: routeMode(request.route.mode, this.options.mode ?? "conductor"),
        prompt: taskPrompt(request.task),
        role: this.options.role ?? request.route.agentId,
        systemPrompt: this.options.systemPrompt,
        cwd: request.environment.workspaceDir,
        env,
        inheritProcessEnv: this.options.inheritProcessEnv ?? false,
        redactValues,
        timeoutMs: request.route.timeoutMs,
        ownership: policy.externalAgentOwnership(),
        mergePolicy: this.options.mergePolicy ?? "manual",
        sharedContext: {
          sessionId: request.session.id,
          taskId: request.task.id,
          trigger: request.trigger,
          route: request.route,
          successCriteria: request.task.successCriteria,
        },
        metadata: {
          platformSessionId: request.session.id,
          identityId: request.identity.id,
          capabilityGrantId: request.capabilityGrant.id,
        },
      },
      (event) => {
        events.push(event);
        this.options.onEvent?.(event, request);
      },
      request.signal,
    );

    const status = result.status === "completed" ? "completed" : "failed";
    const summary = redact(result.output || result.error || `External agent ${result.status}.`, env);
    const eventArtifacts = artifactsFromEvents(result.events, env);
    const resume = summarizeResumeMetadata(result.resume);
    const fallbackArtifact: OutputArtifactInput = {
      type: "report",
      title: "External agent report",
      content: summary,
      metadata: {
        provider: result.provider,
        agentId: result.agentId,
        mode: result.mode,
        eventCount: result.events.length,
        exitCode: result.exitCode,
        resume,
        providerMetadataKeys: result.metadata ? Object.keys(result.metadata).sort() : undefined,
      },
    };
    const artifacts = status === "failed"
      ? [
          ...eventArtifacts,
          failedRunDiagnosis(summary, {
            ...result,
            error: result.error ? redact(result.error, env) : undefined,
          }),
        ]
      : eventArtifacts.length > 0
        ? eventArtifacts
        : [fallbackArtifact];

    return {
      status,
      summary,
      artifacts,
      telemetry: {
        durationMs: Math.max(0, result.endedAt - result.startedAt),
        metadata: {
          provider: result.provider,
          mode: result.mode,
          eventCount: result.events.length,
          exitCode: result.exitCode,
        },
      },
      error: result.error ? redact(result.error, env) : undefined,
      metadata: {
        provider: result.provider,
        mode: result.mode,
        observedEvents: events.length,
        resume,
        providerMetadataKeys: result.metadata ? Object.keys(result.metadata).sort() : undefined,
      },
    };
  }
}

export function createExternalAgentSessionRunner(
  options: ExternalAgentSessionRunnerOptions,
): ExternalAgentSessionRunner {
  return new ExternalAgentSessionRunner(options);
}
