// ============================================================
// @oni.bot/core/platform - Swarm session runner
// ============================================================
// Runs compiled ONI/Swarm skeletons behind the platform
// AgentSessionRunner contract.
// ============================================================

import type {
  ONIConfig,
  ONISkeleton,
} from "../types.js";
import type { BaseSwarmState } from "../swarm/index.js";
import type {
  AgentRunOutcome,
  AgentRunRequest,
  AgentSessionRunner,
} from "./types.js";
import { createRuntimePolicy } from "./policy.js";

export type SwarmRunnable<S extends BaseSwarmState = BaseSwarmState> =
  | ONISkeleton<S>
  | { compile(): ONISkeleton<S> };

export interface SwarmSessionRunnerOptions<S extends BaseSwarmState = BaseSwarmState> {
  swarm: SwarmRunnable<S> | ((request: AgentRunRequest) => SwarmRunnable<S> | Promise<SwarmRunnable<S>>);
  input?: Partial<S> | ((request: AgentRunRequest) => Partial<S> | Promise<Partial<S>>);
  config?: ONIConfig | ((request: AgentRunRequest) => ONIConfig | Promise<ONIConfig>);
  artifactTitle?: string;
  summarize?: (state: S, request: AgentRunRequest) => string;
}

function isSkeleton<S extends BaseSwarmState>(value: SwarmRunnable<S>): value is ONISkeleton<S> {
  return typeof (value as ONISkeleton<S>).invoke === "function";
}

function compileSwarm<S extends BaseSwarmState>(swarm: SwarmRunnable<S>): ONISkeleton<S> {
  return isSkeleton(swarm) ? swarm : swarm.compile();
}

function defaultInput(request: AgentRunRequest): Partial<BaseSwarmState> {
  return {
    task: request.task.goal,
    context: {
      sessionId: request.session.id,
      taskId: request.task.id,
      trigger: request.trigger,
      route: request.route,
      successCriteria: request.task.successCriteria,
      workspaceDir: request.environment.workspaceDir,
    },
    agentResults: {},
    messages: [],
    swarmMessages: [],
    supervisorRound: 0,
    currentAgent: null,
    done: false,
    handoffHistory: [],
  };
}

function summarizeState(state: BaseSwarmState): string {
  return JSON.stringify({
    done: state.done,
    currentAgent: state.currentAgent,
    agentResults: state.agentResults,
  }, null, 2);
}

function stateMetadata(state: BaseSwarmState): Record<string, unknown> {
  return {
    done: state.done,
    currentAgent: state.currentAgent,
    agentResultKeys: Object.keys(state.agentResults ?? {}).sort(),
    supervisorRound: state.supervisorRound,
    handoffCount: state.handoffHistory?.length ?? 0,
    swarmMessageCount: state.swarmMessages?.length ?? 0,
  };
}

export class SwarmSessionRunner<S extends BaseSwarmState = BaseSwarmState> implements AgentSessionRunner {
  constructor(private readonly options: SwarmSessionRunnerOptions<S>) {}

  async run(request: AgentRunRequest): Promise<AgentRunOutcome> {
    const startedAt = Date.now();
    const policy = createRuntimePolicy(request);
    policy.assertGrantActive();

    try {
      const runnable = typeof this.options.swarm === "function"
        ? await this.options.swarm(request)
        : this.options.swarm;
      const skeleton = compileSwarm(runnable);
      const input = typeof this.options.input === "function"
        ? await this.options.input(request)
        : (this.options.input ?? defaultInput(request) as Partial<S>);
      const config = typeof this.options.config === "function"
        ? await this.options.config(request)
        : (this.options.config ?? {});

      const result = await skeleton.invoke(input, {
        ...config,
        threadId: config.threadId ?? request.session.id,
        signal: request.signal ?? config.signal,
        metadata: {
          ...(config.metadata ?? {}),
          platformSessionId: request.session.id,
          taskId: request.task.id,
        },
      });
      const metadata = stateMetadata(result);
      const summary = this.options.summarize?.(result, request) ?? summarizeState(result);

      return {
        status: "completed",
        summary,
        artifacts: [{
          type: "report",
          title: this.options.artifactTitle ?? "Swarm run report",
          content: summary,
          metadata,
        }],
        telemetry: {
          durationMs: Date.now() - startedAt,
          metadata,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "failed",
        summary: message,
        error: message,
        artifacts: [{
          type: "failed_run_diagnosis",
          title: "Swarm failed run diagnosis",
          content: message,
        }],
        telemetry: {
          durationMs: Date.now() - startedAt,
        },
      };
    }
  }
}

export function createSwarmSessionRunner<S extends BaseSwarmState = BaseSwarmState>(
  options: SwarmSessionRunnerOptions<S>,
): SwarmSessionRunner<S> {
  return new SwarmSessionRunner(options);
}
