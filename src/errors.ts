// ============================================================
// @oni.bot/core — Structured Error Types
// ============================================================

export type ErrorCategory =
  | "GRAPH"
  | "NODE"
  | "EDGE"
  | "CHECKPOINT"
  | "STREAM"
  | "HITL"
  | "SWARM"
  | "MODEL"
  | "STORE"
  | "CONFIG";

export interface ONIErrorOptions {
  code: string;
  category: ErrorCategory;
  recoverable: boolean;
  suggestion?: string;
  context?: Record<string, unknown>;
}

// ── Base class ────────────────────────────────────────────────

export class ONIError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly recoverable: boolean;
  readonly suggestion: string;
  readonly context: Record<string, unknown>;

  constructor(message: string, opts?: ONIErrorOptions) {
    super(message);
    this.name = "ONIError";
    this.code = opts?.code ?? "ONI_UNKNOWN";
    this.category = opts?.category ?? "GRAPH";
    this.recoverable = opts?.recoverable ?? false;
    this.suggestion = opts?.suggestion ?? "";
    this.context = opts?.context ?? {};
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      recoverable: this.recoverable,
      suggestion: this.suggestion,
      context: this.context,
    };
  }

  /** Full serialization including stack and context — for internal logging only. */
  toInternalJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      recoverable: this.recoverable,
      suggestion: this.suggestion,
      context: this.context,
      stack: this.stack,
    };
  }
}

// ── Existing errors (backward-compatible constructors) ────────

export class InvalidSkeletonError extends ONIError {
  constructor(msg: string) {
    super(msg, {
      code: "ONI_GRAPH_INVALID",
      category: "GRAPH",
      recoverable: false,
      suggestion: "Check your graph structure for missing nodes or invalid edges.",
      context: {},
    });
    this.name = "InvalidSkeletonError";
  }
}

export class RecursionLimitError extends ONIError {
  constructor(limit: number) {
    super(
      `Recursion limit of ${limit} reached. Possible infinite loop in agent skeleton.`,
      {
        code: "ONI_RECURSION_LIMIT",
        category: "GRAPH",
        recoverable: false,
        suggestion: "Increase recursionLimit in config or check for cycles in your graph.",
        context: { limit },
      },
    );
    this.name = "RecursionLimitError";
  }
}

export class NodeNotFoundError extends ONIError {
  constructor(name: string) {
    super(`Node "${name}" not found in skeleton.`, {
      code: "ONI_NODE_MISSING",
      category: "NODE",
      recoverable: false,
      suggestion: `Ensure node "${name}" has been added to the graph before referencing it.`,
      context: { node: name },
    });
    this.name = "NodeNotFoundError";
  }
}

export class EdgeConflictError extends ONIError {
  constructor(from: string, to: string) {
    super(`Edge conflict: "${from}" → "${to}" already exists.`, {
      code: "ONI_EDGE_CONFLICT",
      category: "EDGE",
      recoverable: false,
      suggestion: "Remove the duplicate edge or use a conditional edge instead.",
      context: { from, to },
    });
    this.name = "EdgeConflictError";
  }
}

export class NodeExecutionError extends ONIError {
  constructor(node: string, cause: Error, extraContext?: Record<string, unknown>) {
    super(`Node "${node}" failed: ${cause.message}`, {
      code: "ONI_NODE_EXEC",
      category: "NODE",
      recoverable: false,
      suggestion: "Inspect the cause error and consider adding a retry policy.",
      context: { node, ...extraContext },
    });
    this.name = "NodeExecutionError";
    this.cause = cause;
  }
}

// ── New errors ────────────────────────────────────────────────

export class NodeTimeoutError extends ONIError {
  constructor(node: string, timeoutMs: number) {
    super(`Node "${node}" timed out after ${timeoutMs}ms.`, {
      code: "ONI_NODE_TIMEOUT",
      category: "NODE",
      recoverable: true,
      suggestion: "Increase the node timeout or optimize the node's execution time.",
      context: { node, timeoutMs },
    });
    this.name = "NodeTimeoutError";
  }
}

export class CircuitBreakerOpenError extends ONIError {
  constructor(node: string, resetAfterMs: number) {
    super(
      `Circuit breaker for node "${node}" is open. Resets after ${resetAfterMs}ms.`,
      {
        code: "ONI_NODE_CIRCUIT_OPEN",
        category: "NODE",
        recoverable: true,
        suggestion: "Wait for the circuit breaker to reset or fix the underlying failures.",
        context: { node, resetAfterMs },
      },
    );
    this.name = "CircuitBreakerOpenError";
  }
}

export class SwarmDeadlockError extends ONIError {
  constructor(agents: string[]) {
    super(
      `Swarm deadlock detected among agents: ${agents.join(", ")}.`,
      {
        code: "ONI_SWARM_DEADLOCK",
        category: "SWARM",
        recoverable: false,
        suggestion: "Review agent handoff logic to break the circular dependency.",
        context: { agents },
      },
    );
    this.name = "SwarmDeadlockError";
  }
}

export class ModelAPIError extends ONIError {
  constructor(
    provider: string,
    status: number,
    body: string,
    opts?: {
      suggestion?: string;
      messageBody?: string;
    },
  ) {
    const recoverable = status >= 500;
    super(`${provider} API error ${status}${opts?.messageBody ? `: ${opts.messageBody}` : ""}`, {
      code: "ONI_MODEL_API",
      category: "MODEL",
      recoverable,
      suggestion: opts?.suggestion ?? (recoverable
        ? "Retry the request — the provider may be experiencing transient issues."
        : "Check your request parameters, API key, and account status."),
      context: { provider, status, body },
    });
    this.name = "ModelAPIError";
  }
}

export class ModelRateLimitError extends ONIError {
  constructor(provider: string, retryAfterMs?: number) {
    const retryMsg = retryAfterMs != null
      ? ` Retry after ${retryAfterMs}ms.`
      : "";
    super(`Rate limit hit for model provider "${provider}".${retryMsg}`, {
      code: "ONI_MODEL_RATE_LIMIT",
      category: "MODEL",
      recoverable: true,
      suggestion: "Wait and retry, or switch to a different model provider.",
      context: { provider, ...(retryAfterMs != null ? { retryAfterMs } : {}) },
    });
    this.name = "ModelRateLimitError";
  }
}

export class ModelContextLengthError extends ONIError {
  constructor(provider: string, maxTokens: number) {
    super(
      `Context length exceeded for provider "${provider}" (max ${maxTokens} tokens).`,
      {
        code: "ONI_MODEL_CONTEXT",
        category: "MODEL",
        recoverable: false,
        suggestion: "Reduce the input size, trim messages, or use a model with a larger context window.",
        context: { provider, maxTokens },
      },
    );
    this.name = "ModelContextLengthError";
  }
}

export class CheckpointCorruptError extends ONIError {
  constructor(threadId: string, detail: string) {
    super(`Checkpoint for thread "${threadId}" is corrupt: ${detail}`, {
      code: "ONI_CHECKPOINT_CORRUPT",
      category: "CHECKPOINT",
      recoverable: false,
      suggestion: "Delete the corrupt checkpoint and restart from a known-good state.",
      context: { threadId, detail },
    });
    this.name = "CheckpointCorruptError";
  }
}

export class StoreKeyNotFoundError extends ONIError {
  constructor(namespace: string[], key: string) {
    const ns = namespace.join(".");
    super(`Key "${key}" not found in store namespace [${ns}].`, {
      code: "ONI_STORE_KEY",
      category: "STORE",
      recoverable: false,
      suggestion: "Verify the namespace and key exist before accessing them.",
      context: { namespace, key },
    });
    this.name = "StoreKeyNotFoundError";
  }
}

// ── ONIInterrupt (not an Error — unchanged) ───────────────────

/** Thrown at interrupt checkpoints — caught externally to pause/resume */
export class ONIInterrupt {
  readonly isONIInterrupt = true;
  constructor(
    public readonly node:   string,
    public readonly timing: "before" | "after",
    public readonly state:  unknown
  ) {}
}
