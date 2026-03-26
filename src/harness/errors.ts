// ============================================================
// @oni.bot/core/harness — Error Types
// ============================================================
// All harness-specific errors extend ONIHarnessError.
// Each carries a machine-readable `code` for programmatic handling.
// ============================================================

export class ONIHarnessError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ONIHarnessError";
  }
}

export class FeatureRegistryMutationError extends ONIHarnessError {
  constructor(featureId: string, attemptedField: string) {
    super(
      `Attempted to mutate immutable field "${attemptedField}" on feature "${featureId}". ` +
      `Agents may only change "passes" and "failureNotes".`,
      "FEATURE_REGISTRY_ILLEGAL_MUTATION",
    );
    this.name = "FeatureRegistryMutationError";
  }
}

export class FeatureRegistryAlreadyInitializedError extends ONIHarnessError {
  constructor(path: string) {
    super(
      `FeatureRegistry already initialized at "${path}". ` +
      `Call initialize() only once from the initializer agent.`,
      "FEATURE_REGISTRY_ALREADY_INITIALIZED",
    );
    this.name = "FeatureRegistryAlreadyInitializedError";
  }
}

export class FeatureNotFoundError extends ONIHarnessError {
  constructor(featureId: string) {
    super(
      `Feature "${featureId}" not found in registry.`,
      "FEATURE_NOT_FOUND",
    );
    this.name = "FeatureNotFoundError";
  }
}

export class SessionBridgeNotOpenError extends ONIHarnessError {
  constructor() {
    super(
      "SessionBridge.close() called before open(). Call open() at session start.",
      "SESSION_BRIDGE_NOT_OPEN",
    );
    this.name = "SessionBridgeNotOpenError";
  }
}

export class EnvironmentUnhealthyError extends ONIHarnessError {
  constructor(public readonly smokeTestOutput: string) {
    super(
      `Smoke test failed at session start. Environment is unhealthy. ` +
      `Review smokeTestOutput for details.`,
      "ENVIRONMENT_UNHEALTHY",
    );
    this.name = "EnvironmentUnhealthyError";
  }
}

export class ContractNotFoundError extends ONIHarnessError {
  constructor(id: string) {
    super(
      `Contract or proposal "${id}" not found.`,
      "CONTRACT_NOT_FOUND",
    );
    this.name = "ContractNotFoundError";
  }
}

export class ContractNotApprovedError extends ONIHarnessError {
  constructor(proposalId: string) {
    super(
      `Proposal "${proposalId}" has not been approved. Cannot finalize contract.`,
      "CONTRACT_NOT_APPROVED",
    );
    this.name = "ContractNotApprovedError";
  }
}

export class WorkspaceGitUnavailableWarning {
  readonly message = "git not found in PATH. WorkspaceCheckpointer running in SQLite-only mode.";
  readonly code = "GIT_UNAVAILABLE";
}
