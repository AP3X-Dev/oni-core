// ============================================================
// @oni.bot/core/platform - Harness agentLoop session runner
// ============================================================
// Runs the native harness agent loop behind the platform
// AgentSessionRunner contract.
// ============================================================

import { agentLoop } from "../harness/agent-loop.js";
import type {
  AgentLoopConfig,
  LoopMessage,
} from "../harness/types.js";
import type {
  AgentRunOutcome,
  AgentRunRequest,
  AgentSessionRunner,
  OutputArtifactInput,
  TaskSpec,
} from "./types.js";
import { createRuntimePolicy } from "./policy.js";
import {
  wrapToolsWithRuntimePolicy,
  type PlatformToolPolicyMap,
} from "./tool-policy.js";

export interface AgentLoopSessionRunnerOptions {
  config: AgentLoopConfig | ((request: AgentRunRequest) => AgentLoopConfig | Promise<AgentLoopConfig>);
  prompt?: (request: AgentRunRequest) => string;
  systemPrompt?: string;
  artifactTitle?: string;
  wrapToolsWithPolicy?: boolean;
  toolPolicy?: PlatformToolPolicyMap;
  onMessage?: (message: LoopMessage, request: AgentRunRequest) => void;
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

function cloneConfig(config: AgentLoopConfig): AgentLoopConfig {
  return {
    ...config,
    tools: [...config.tools],
    initialMessages: config.initialMessages ? [...config.initialMessages] : undefined,
    env: config.env ? { ...config.env } : undefined,
    messageQueue: config.messageQueue ? [...config.messageQueue] : undefined,
  };
}

function summarizeMessages(messages: LoopMessage[]): Record<string, unknown> {
  return {
    count: messages.length,
    types: messages.reduce<Record<string, number>>((counts, message) => {
      counts[message.type] = (counts[message.type] ?? 0) + 1;
      return counts;
    }, {}),
    lastTurn: messages.at(-1)?.turn,
  };
}

export class AgentLoopSessionRunner implements AgentSessionRunner {
  constructor(private readonly options: AgentLoopSessionRunnerOptions) {}

  async run(request: AgentRunRequest): Promise<AgentRunOutcome> {
    const startedAt = Date.now();
    const policy = createRuntimePolicy(request);
    policy.assertGrantActive();

    const baseConfig = typeof this.options.config === "function"
      ? await this.options.config(request)
      : this.options.config;
    const config = cloneConfig(baseConfig);
    if (this.options.systemPrompt) {
      config.systemPrompt = [this.options.systemPrompt, config.systemPrompt]
        .filter(Boolean)
        .join("\n\n");
    }
    if (this.options.wrapToolsWithPolicy ?? true) {
      config.tools = wrapToolsWithRuntimePolicy(config.tools, policy, this.options.toolPolicy);
    }
    config.signal = request.signal ?? config.signal;
    config.threadId = config.threadId ?? request.session.id;
    config.env = { ...(config.env ?? {}) };
    if (!config.env.cwd && request.environment.workspaceDir) {
      config.env.cwd = request.environment.workspaceDir;
    }

    const prompt = this.options.prompt?.(request) ?? taskPrompt(request.task);
    const messages: LoopMessage[] = [];
    let result = "";
    let lastError = "";

    for await (const message of agentLoop(prompt, config)) {
      messages.push(message);
      this.options.onMessage?.(message, request);
      if (message.type === "result") {
        result = message.content ?? "";
      } else if (message.type === "error") {
        lastError = message.content ?? "Unknown agent loop error.";
      }
    }

    const messageSummary = summarizeMessages(messages);
    const durationMs = Date.now() - startedAt;
    if (!result && lastError) {
      return {
        status: "failed",
        summary: lastError,
        error: lastError,
        artifacts: [{
          type: "failed_run_diagnosis",
          title: "Agent loop failed run diagnosis",
          content: lastError,
          metadata: messageSummary,
        }],
        telemetry: {
          durationMs,
          metadata: messageSummary,
        },
      };
    }

    const summary = result || "Agent loop finished without a final result.";
    const artifact: OutputArtifactInput = {
      type: "report",
      title: this.options.artifactTitle ?? "Agent loop report",
      content: summary,
      metadata: messageSummary,
    };

    return {
      status: "completed",
      summary,
      artifacts: [artifact],
      telemetry: {
        durationMs,
        metadata: messageSummary,
      },
    };
  }
}

export function createAgentLoopSessionRunner(
  options: AgentLoopSessionRunnerOptions,
): AgentLoopSessionRunner {
  return new AgentLoopSessionRunner(options);
}
