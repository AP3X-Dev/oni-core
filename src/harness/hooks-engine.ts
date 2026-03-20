// ============================================================
// @oni.bot/core/harness — HooksEngine
// 12 lifecycle events for the agent loop
// ============================================================

// ─── HookEvent ──────────────────────────────────────────────────────────────

export type HookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop"
  | "Notification"
  | "PreCompact"
  | "PostCompact"
  | "AgentBeforeDecision"
  | "AgentAfterOutcome"
  | "SkillUsed"
  | "SkillRevised";

// ─── Payload Interfaces ─────────────────────────────────────────────────────

export interface BasePayload {
  sessionId: string;
  [key: string]: unknown;
}

export interface SessionStartPayload extends BasePayload {
  agentName: string;
  tools: string[];
}

export interface SessionEndPayload extends BasePayload {
  reason: string;
  turns: number;
}

export interface UserPromptPayload extends BasePayload {
  prompt: string;
}

export interface PreToolUsePayload extends BasePayload {
  toolName: string;
  input: Record<string, unknown>;
}

export interface PostToolUsePayload extends BasePayload {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  durationMs?: number;
}

export interface PostToolUseFailurePayload extends BasePayload {
  toolName: string;
  input: Record<string, unknown>;
  error: Error | string;
}

export interface StopPayload extends BasePayload {
  response: string;
}

export interface PreCompactPayload extends BasePayload {
  messageCount: number;
  estimatedTokens: number;
}

export interface PostCompactPayload extends BasePayload {
  beforeCount: number;
  afterCount: number;
  estimatedTokensAfter?: number;
  summarized?: boolean;
}

export interface SubagentPayload extends BasePayload {
  agentName: string;
  parentSessionId?: string;
}

export interface AgentBeforeDecisionPayload extends BasePayload {
  agentId: string;
  currentMetrics: Record<string, number>;
  recentHistory: import("../swarm/self-improvement/experiment-log.js").ExperimentRecord[];
}

export interface AgentAfterOutcomePayload extends BasePayload {
  agentId: string;
  hypothesis: string;
  success: boolean;
  metricBefore: number;
  metricAfter: number | null;
}

export interface SkillUsedPayload extends BasePayload {
  skillName: string;
  outcome: "success" | "failure";
  context: string;
}

export interface SkillRevisedPayload extends BasePayload {
  skillName: string;
  previousSuccessRate: number;
  newSuccessRate: number | null;
  committed: boolean;
}

// ─── HookResult ─────────────────────────────────────────────────────────────

export interface HookResult {
  decision: "allow" | "deny" | "block" | "escalate";
  reason?: string;
  additionalContext?: string;
  modifiedInput?: Record<string, unknown>;
}

// ─── HookDefinition ─────────────────────────────────────────────────────────

export interface HookDefinition {
  /** Regex/pattern for tool name filtering. Supports pipe OR, wildcard, arg patterns. */
  matcher?: string;
  handler: (payload: BasePayload) => Promise<HookResult> | HookResult;
  timeout?: number;
  description?: string;
}

// ─── HooksConfig ────────────────────────────────────────────────────────────

export type HooksConfig = Partial<Record<HookEvent, HookDefinition[]>>;

// ─── withTimeout helper ─────────────────────────────────────────────────────

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    handle = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(handle)),
    timeout,
  ]);
}

// ─── HooksEngine ────────────────────────────────────────────────────────────

export class HooksEngine {
  private hooks: Map<HookEvent, HookDefinition[]> = new Map();
  private anyListeners: Array<(event: HookEvent, payload: BasePayload) => void> = [];

  // ── Registration ────────────────────────────────────────────────────

  on(event: HookEvent, definition: HookDefinition): void {
    const list = this.hooks.get(event);
    if (list) {
      list.push(definition);
    } else {
      this.hooks.set(event, [definition]);
    }
  }

  configure(config: HooksConfig): void {
    for (const event of Object.keys(config) as HookEvent[]) {
      const defs = config[event];
      if (defs) {
        for (const def of defs) {
          this.on(event, def);
        }
      }
    }
  }

  off(event: HookEvent): void {
    this.hooks.delete(event);
  }

  clear(): void {
    this.hooks.clear();
    this.anyListeners = [];
  }

  // ── Observability ───────────────────────────────────────────────────

  onAny(listener: (event: HookEvent, payload: BasePayload) => void): () => void {
    this.anyListeners.push(listener);
    return () => {
      const idx = this.anyListeners.indexOf(listener);
      if (idx !== -1) this.anyListeners.splice(idx, 1);
    };
  }

  // ── Fire ────────────────────────────────────────────────────────────

  async fire(event: HookEvent, payload: BasePayload): Promise<HookResult | null> {
    // Notify any-listeners (best-effort)
    for (const listener of this.anyListeners) {
      try {
        listener(event, payload);
      } catch {
        // silently ignore
      }
    }

    const defs = this.hooks.get(event);
    if (!defs || defs.length === 0) return null;

    const aggregatedContext: string[] = [];

    for (const def of defs) {
      // Check matcher against toolName in payload
      if (def.matcher && !this.matches(def.matcher, payload)) {
        continue;
      }

      let result: HookResult | null;
      try {
        const promise = Promise.resolve(def.handler(payload));
        if (def.timeout != null && def.timeout > 0) {
          result = await withTimeout(promise, def.timeout);
        } else {
          result = await promise;
        }
      } catch (err) {
        // Security-critical hooks fail closed (deny) on error
        if (event === "PreToolUse" || event === "PermissionRequest") {
          console.error(`[hooks-engine] ${event} hook crashed — denying (fail-closed):`, err);
          return { decision: "deny", reason: "Hook error: fail-closed for security" };
        }
        // Non-security hooks fail open (pass)
        result = null;
      }

      // Security-critical hooks must fail-closed on timeout (result is null
      // when withTimeout fires). Non-security hooks can safely skip.
      if (result == null) {
        if (event === "PreToolUse" || event === "PermissionRequest") {
          console.error(`[hooks-engine] ${event} hook timed out — denying (fail-closed)`);
          return { decision: "deny", reason: "Hook timeout — fail-closed for security" };
        }
        continue;
      }

      // Short-circuit on deny or block
      if (result.decision === "deny" || result.decision === "block") {
        // Attach any previously aggregated context
        if (aggregatedContext.length > 0) {
          result.additionalContext = [
            ...aggregatedContext,
            ...(result.additionalContext ? [result.additionalContext] : []),
          ].join("\n");
        }
        return result;
      }

      // Collect additionalContext from allow/escalate results
      if (result.additionalContext) {
        aggregatedContext.push(result.additionalContext);
      }
    }

    // All hooks passed
    if (aggregatedContext.length > 0) {
      return {
        decision: "allow",
        additionalContext: aggregatedContext.join("\n"),
      };
    }

    return null;
  }

  // ── Matcher ─────────────────────────────────────────────────────────

  private matches(matcher: string, payload: BasePayload): boolean {
    const toolName = (payload as PreToolUsePayload).toolName;
    if (!toolName) return true;

    // Wildcard — matches everything
    if (matcher === "*") return true;

    // CC-style arg pattern: "Bash(git:*)"
    const argMatch = matcher.match(/^([^(]+)\((.+)\)$/);
    if (argMatch) {
      const toolPattern = argMatch[1]!;
      const argPattern = argMatch[2]!;

      if (toolName !== toolPattern) return false;

      // Extract the arg prefix from pattern like "git:*" → prefix "git"
      const input = (payload as PreToolUsePayload).input;
      if (!input) return false;

      // Check ALL string values in input against the arg pattern.
      // Previously only the first string value (by insertion order) was checked,
      // which allowed bypassing the pattern by reordering keys (BUG-0028).
      const argPrefix = argPattern.replace(/:\*$/, "");
      return Object.values(input).some(
        (v) => typeof v === "string" && v.startsWith(argPrefix),
      );
    }

    // Pipe-separated OR patterns: "Write|Edit"
    const patterns = matcher.split("|");
    return patterns.some((p) => p === toolName);
  }

  // ── Static Factories ──────────────────────────────────────────────

  static withSecurityGuardrails(): HooksEngine {
    const engine = new HooksEngine();

    // O(n) check for rm with both -r and -f flags (any order, combined or separate).
    // Replaces lookahead-based regex that was vulnerable to ReDoS on adversarial input.
    const hasRmRf = (cmd: string): boolean => {
      const tokens = cmd.split(/\s+/);
      let foundRm = false;
      let hasR = false;
      let hasF = false;
      for (const tok of tokens) {
        if (!foundRm) {
          if (tok === "rm") foundRm = true;
          continue;
        }
        if (tok.startsWith("-")) {
          if (/[rR]/.test(tok)) hasR = true;
          if (/[fF]/.test(tok)) hasF = true;
        } else {
          // Non-flag after rm — still check subsequent tokens for flags
        }
        if (hasR && hasF) return true;
      }
      return false;
    };

    const dangerousBashPatterns = [
      /mkfs/,
      /dd\s+if=/,
      /chmod\s+777/,
      /curl[^|]*\|\s*sh/,
      /curl[^|]*\|\s*bash/,
      /wget[^|]*\|\s*sh/,
      /wget[^|]*\|\s*bash/,
      // Shell indirection: eval with dangerous commands in any quoting style
      /eval\s+.*rm\b/,
      /eval\s+.*mkfs/,
      /eval\s+.*dd\s+if=/,
      /eval\s+.*chmod\s+777/,
      />\s*\/tmp\/.*&&.*sh/,
      /-O\s*\/tmp\/.*&&.*sh/,
      /LD_PRELOAD\s*=/,
      /chmod\s+.*\+s/,
      /chmod\s+[0-7]*[4-7][0-7]{2}\s/,
      /\/dev\/tcp\//,
      /nc\s+.*-e/,
      /ncat\s+.*-e/,
      /socat\s+.*exec/i,
      /python[23]?\s+-c/,
      /perl\s+-e/,
      /ruby\s+-e/,
      /node\s+-e/,
    ];

    const sensitiveFilePatterns = [
      /\.env$/,
      /\.env\./,
      /\.pem$/,
      /id_rsa/,
      /credentials/,
    ];

    engine.on("PreToolUse", {
      description: "Block dangerous bash commands",
      matcher: "*",
      handler: async (payload: BasePayload) => {
        const p = payload as PreToolUsePayload;
        const input = p.input ?? {};

        // Check bash commands
        if (p.toolName === "Bash") {
          const command = typeof input.command === "string" ? input.command : "";
          if (hasRmRf(command)) {
            return {
              decision: "deny" as const,
              reason: "Dangerous command blocked: rm with -r and -f flags",
            };
          }
          for (const pattern of dangerousBashPatterns) {
            if (pattern.test(command)) {
              return {
                decision: "deny" as const,
                reason: `Dangerous command blocked: matches ${pattern.source}`,
              };
            }
          }
        }

        // Check file access for sensitive files
        const filePath =
          typeof input.file_path === "string"
            ? input.file_path
            : typeof input.path === "string"
              ? input.path
              : "";

        if (filePath) {
          for (const pattern of sensitiveFilePatterns) {
            if (pattern.test(filePath)) {
              return {
                decision: "deny" as const,
                reason: `Sensitive file access blocked: ${filePath}`,
              };
            }
          }
        }

        return { decision: "allow" as const };
      },
    });

    return engine;
  }

  static withQualityGate(validate: (response: string) => string | null): HooksEngine {
    const engine = new HooksEngine();

    engine.on("Stop", {
      description: "Quality gate — validates response before allowing stop",
      handler: async (payload: BasePayload) => {
        const p = payload as StopPayload;
        const feedback = validate(p.response);
        if (feedback) {
          return {
            decision: "block" as const,
            reason: feedback,
          };
        }
        return { decision: "allow" as const };
      },
    });

    return engine;
  }

  static compose(...engines: HooksEngine[]): HooksEngine {
    const merged = new HooksEngine();
    for (const engine of engines) {
      for (const [event, defs] of engine.hooks.entries()) {
        for (const def of defs) {
          merged.on(event, def);
        }
      }
      for (const listener of engine.anyListeners) {
        merged.onAny(listener);
      }
    }
    return merged;
  }
}
