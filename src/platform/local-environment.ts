// ============================================================
// @oni.bot/core/platform - Local execution environment provider
// ============================================================
// Creates a session-scoped workspace directory for local/single-node
// background-agent runs.
// ============================================================

import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  EnvironmentSize,
  ExecutionEnvironment,
  ExecutionEnvironmentProvider,
  ExecutionEnvironmentRequest,
} from "./types.js";
import { pathLooksInside } from "./policy.js";

export interface LocalExecutionEnvironmentProviderOptions {
  workspaceRoot: string;
  provider?: string;
  image?: string;
  defaultSize?: EnvironmentSize;
  clock?: () => Date;
  idFactory?: (prefix: string) => string;
}

function defaultId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(clock: () => Date): string {
  return clock().toISOString();
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "session";
}

export class LocalExecutionEnvironmentProvider implements ExecutionEnvironmentProvider {
  private readonly environments = new Map<string, ExecutionEnvironment>();
  private readonly workspaceRoot: string;
  private readonly clock: () => Date;
  private readonly idFactory: (prefix: string) => string;

  constructor(private readonly options: LocalExecutionEnvironmentProviderOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultId;
  }

  async provision(request: ExecutionEnvironmentRequest): Promise<ExecutionEnvironment> {
    const id = this.idFactory("env");
    const timestamp = nowIso(this.clock);
    const workspaceDir = resolve(this.workspaceRoot, safeSegment(request.sessionId));
    if (!pathLooksInside(workspaceDir, this.workspaceRoot)) {
      throw new Error(`Resolved workspace escaped workspace root: ${workspaceDir}`);
    }
    await mkdir(workspaceDir, { recursive: true });

    const environment: ExecutionEnvironment = {
      id,
      provider: this.options.provider ?? "local",
      status: "ready",
      size: request.route.environmentSize ?? this.options.defaultSize ?? "small",
      workspaceDir,
      image: this.options.image,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: {
        workspaceRoot: this.workspaceRoot,
        taskId: request.task.id,
      },
    };
    this.environments.set(id, structuredClone(environment));
    return environment;
  }

  release(environment: ExecutionEnvironment, reason: string): void {
    const existing = this.environments.get(environment.id) ?? environment;
    const timestamp = nowIso(this.clock);
    const released: ExecutionEnvironment = {
      ...existing,
      status: "released",
      releasedAt: timestamp,
      updatedAt: timestamp,
      metadata: {
        ...(existing.metadata ?? {}),
        releaseReason: reason,
      },
    };
    this.environments.set(environment.id, structuredClone(released));
  }

  async health(environment: ExecutionEnvironment): Promise<boolean> {
    if (!environment.workspaceDir) return false;
    try {
      const stats = await stat(environment.workspaceDir);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  get(environmentId: string): ExecutionEnvironment | null {
    const environment = this.environments.get(environmentId);
    return environment ? structuredClone(environment) : null;
  }
}
