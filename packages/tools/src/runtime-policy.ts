// ============================================================
// @oni.bot/tools — Structural runtime policy
// ============================================================
// A dependency-free shape that platform RuntimePolicy instances satisfy, so
// tools can enforce grant/capability/path/network checks below the prompt
// layer without importing @oni.bot/core internals. The capability union must
// match the core Capability["type"] union so a real RuntimePolicy is assignable.
// ============================================================

export type RuntimePolicyCapabilityType =
  | "tool"
  | "secret"
  | "connector"
  | "network"
  | "repo"
  | "command"
  | "custom";

/** Path/capability-aware policy shape (used by filesystem tools). */
export interface RuntimePolicyLike {
  assertGrantActive(): void;
  assertCapability(type: RuntimePolicyCapabilityType, name?: string): void;
  assertPathAllowed(path: string): string;
}

/**
 * Policy shape for code-execution tools. Path access is not relevant (code runs
 * in an isolated subprocess/sandbox), but network and command grants are.
 */
export interface CodeExecutionRuntimePolicyLike {
  assertGrantActive(): void;
  assertCapability(type: RuntimePolicyCapabilityType, name?: string): void;
  assertNetworkAllowed(): void;
}

export interface CodeExecutionPolicyOptions {
  /** Enforce grant + capability (and network, when required) before executing. */
  runtimePolicy?: CodeExecutionRuntimePolicyLike;
  /** Require a granted "tool" capability matching the tool name. Defaults to true. */
  assertToolCapability?: boolean;
}

/**
 * Apply the shared code-execution policy gate. No-op when no policy is given,
 * preserving the tools' standalone behavior.
 */
export function enforceCodeExecutionPolicy(
  toolName: string,
  options: CodeExecutionPolicyOptions,
  opts: { requiresNetwork: boolean },
): void {
  const policy = options.runtimePolicy;
  if (!policy) return;
  policy.assertGrantActive();
  if (options.assertToolCapability ?? true) {
    policy.assertCapability("tool", toolName);
  }
  if (opts.requiresNetwork) {
    policy.assertNetworkAllowed();
  }
}
