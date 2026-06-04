// ============================================================
// @oni.bot/core/platform - Runtime policy helpers
// ============================================================
// Converts task scope and capability grants into runtime checks that
// callers can apply below the prompt layer.
// ============================================================

import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type {
  AgentRunRequest,
  Capability,
  CapabilityGrant,
  TaskScope,
  TaskSpec,
} from "./types.js";

export class PlatformPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformPolicyError";
  }
}

export interface RuntimePolicySnapshot {
  sessionId: string;
  workspaceDir?: string;
  allowedPaths: string[];
  disallowedPaths: string[];
  allowedCommands: string[];
  network: NonNullable<TaskScope["network"]>;
  connectors: string[];
  secrets: string[];
  capabilities: Capability[];
}

export interface RuntimePolicy {
  readonly snapshot: RuntimePolicySnapshot;
  assertGrantActive(): void;
  assertCapability(type: Capability["type"], name?: string): void;
  assertPathAllowed(path: string): string;
  assertCommandAllowed(command: string): void;
  assertNetworkAllowed(): void;
  filterEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
  externalAgentOwnership(): {
    allowedPaths?: string[];
    disallowedPaths?: string[];
    description?: string;
  };
}

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function isInsidePath(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function resolveScopedPath(path: string, workspaceDir?: string): string {
  const base = workspaceDir ? resolve(workspaceDir) : process.cwd();
  return normalize(isAbsolute(path) ? resolve(path) : resolve(base, path));
}

function deepestExisting(path: string): { existing: string; tail: string[] } {
  let current = path;
  const tail: string[] = [];
  while (!existsSync(current)) {
    tail.unshift(current.split(/[\\/]/).at(-1) ?? "");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { existing: current, tail };
}

function resolveRealPath(path: string): string {
  const abs = normalize(resolve(path));
  if (existsSync(abs)) return realpathSync(abs);

  const { existing, tail } = deepestExisting(abs);
  const realExisting = existsSync(existing) ? realpathSync(existing) : existing;
  return normalize(resolve(realExisting, ...tail));
}

function normalizeScopedPaths(paths: string[] | undefined, workspaceDir?: string): string[] {
  return (paths ?? []).map((path) => resolveScopedPath(path, workspaceDir));
}

function hasCapability(grant: CapabilityGrant, type: Capability["type"], name?: string): boolean {
  return grant.capabilities.some((capability) => (
    capability.type === type && (name === undefined || capability.name === name)
  ));
}

export function createRuntimePolicy(request: AgentRunRequest): RuntimePolicy {
  const workspaceDir = request.environment.workspaceDir
    ? resolve(request.environment.workspaceDir)
    : undefined;
  return createRuntimePolicyFromParts({
    sessionId: request.session.id,
    task: request.task,
    grant: request.capabilityGrant,
    workspaceDir,
  });
}

export function createRuntimePolicyFromParts(input: {
  sessionId: string;
  task: TaskSpec;
  grant: CapabilityGrant;
  workspaceDir?: string;
}): RuntimePolicy {
  const scope = input.task.scope ?? {};
  const allowedPaths = scope.allowedPaths === undefined
    ? (input.workspaceDir ? [resolve(input.workspaceDir)] : [])
    : normalizeScopedPaths(scope.allowedPaths, input.workspaceDir);
  const disallowedPaths = normalizeScopedPaths(scope.disallowedPaths, input.workspaceDir);
  if (input.workspaceDir) {
    const workspaceRoot = resolve(input.workspaceDir);
    for (const path of [...allowedPaths, ...disallowedPaths]) {
      if (!isInsidePath(path, workspaceRoot)) {
        throw new PlatformPolicyError(`Task path scope escapes workspace: "${path}".`);
      }
    }
  }
  const allowedCommands = (scope.allowedCommands ?? []).map(normalizeCommand);
  const network = scope.network ?? "none";
  const connectors = [...(scope.connectors ?? [])];
  const secrets = [...(scope.secrets ?? [])];

  const snapshot: RuntimePolicySnapshot = {
    sessionId: input.sessionId,
    workspaceDir: input.workspaceDir,
    allowedPaths,
    disallowedPaths,
    allowedCommands,
    network,
    connectors,
    secrets,
    capabilities: cloneRecord(input.grant.capabilities),
  };

  const assertGrantActive = (): void => {
    if (input.grant.status !== "active") {
      throw new PlatformPolicyError(`Capability grant is not active: ${input.grant.id}`);
    }
  };

  return {
    snapshot,

    assertGrantActive,

    assertCapability(type: Capability["type"], name?: string): void {
      assertGrantActive();
      if (!hasCapability(input.grant, type, name)) {
        const suffix = name ? ` "${name}"` : "";
        throw new PlatformPolicyError(`Capability ${type}${suffix} is not granted.`);
      }
    },

    assertPathAllowed(path: string): string {
      assertGrantActive();
      if (allowedPaths.length === 0) {
        throw new PlatformPolicyError("Path access denied: no allowed paths are configured.");
      }

      const requested = resolveScopedPath(path, input.workspaceDir);
      const realRequested = resolveRealPath(requested);
      for (const disallowed of disallowedPaths) {
        const realDisallowed = resolveRealPath(disallowed);
        if (isInsidePath(realRequested, realDisallowed)) {
          throw new PlatformPolicyError(
            `Path access denied: "${path}" is inside disallowed path "${disallowed}".`,
          );
        }
      }

      for (const allowed of allowedPaths) {
        const realAllowed = resolveRealPath(allowed);
        if (isInsidePath(realRequested, realAllowed)) return realRequested;
      }

      throw new PlatformPolicyError(
        `Path access denied: "${path}" is outside allowed paths: ${allowedPaths.join(", ")}.`,
      );
    },

    assertCommandAllowed(command: string): void {
      assertGrantActive();
      const normalized = normalizeCommand(command);
      if (!allowedCommands.includes(normalized)) {
        throw new PlatformPolicyError(`Command denied by task scope: "${command}".`);
      }
      if (!hasCapability(input.grant, "command", normalized)) {
        throw new PlatformPolicyError(`Command capability is not granted: "${command}".`);
      }
    },

    assertNetworkAllowed(): void {
      assertGrantActive();
      if (network === "none") {
        throw new PlatformPolicyError("Network access denied by task scope.");
      }
      if (!hasCapability(input.grant, "network", "network")) {
        throw new PlatformPolicyError("Network capability is not granted.");
      }
    },

    filterEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
      assertGrantActive();
      const allowedSecrets = new Set(secrets);
      const filtered: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(env)) {
        if (!allowedSecrets.has(key)) {
          throw new PlatformPolicyError(`Secret/env access denied by task scope: "${key}".`);
        }
        if (!hasCapability(input.grant, "secret", key)) {
          throw new PlatformPolicyError(`Secret capability is not granted: "${key}".`);
        }
        filtered[key] = value;
      }
      return filtered;
    },

    externalAgentOwnership() {
      return {
        allowedPaths,
        disallowedPaths,
        description: [
          allowedPaths.length > 0 ? `Allowed paths: ${allowedPaths.join(", ")}` : "No filesystem paths granted",
          disallowedPaths.length > 0 ? `Disallowed paths: ${disallowedPaths.join(", ")}` : undefined,
          network === "none" ? "Network access is denied" : `Network access: ${network}`,
        ].filter(Boolean).join("; "),
      };
    },
  };
}

export function pathLooksInside(path: string, parent: string): boolean {
  const normalizedPath = normalize(path);
  const normalizedParent = normalize(parent);
  return normalizedPath === normalizedParent || normalizedPath.startsWith(normalizedParent + sep);
}
