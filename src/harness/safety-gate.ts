// ============================================================
// @oni.bot/core/harness — SafetyGate
// Fast-model pre-execution checks for destructive operations
// ============================================================

import type { ONIModel } from "../models/types.js";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface SafetyGateConfig {
  safetyModel: ONIModel;
  protectedTools?: string[];
  safetySystemPrompt?: string;
  timeout?: number;
}

export interface SafetyCheckResult {
  approved: boolean;
  reason?: string;
  riskScore?: number;
  suggestion?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PROTECTED_TOOLS = ["Bash", "Write", "MultiEdit"];
const DEFAULT_TIMEOUT = 5000;

const DEFAULT_SAFETY_PROMPT = `You are a safety evaluator for an AI agent's tool calls. Analyze the tool call and respond with a JSON object:
{"approved": boolean, "reason": string, "riskScore": number (0-1), "suggestion"?: string}

Be strict about:
- Irreversible deletions (rm -rf, DROP TABLE, etc.)
- Broad file writes that could overwrite important files
- Pipe-to-shell patterns (curl | sh, wget | bash)
- Credential access (.env, secrets, tokens, API keys)

Be permissive about:
- Read operations (cat, ls, grep, find)
- Targeted writes to specific files
- Build and test commands (npm test, make, vitest)
- Version control operations (git status, git diff)

Respond ONLY with the JSON object, no other text.`;

// ─── Fallback result ────────────────────────────────────────────────────────

const FALLBACK_RESULT: SafetyCheckResult = {
  approved: false,
  reason: "Safety check unavailable (timeout/error) — failing closed",
  riskScore: 1.0,
};

// ─── SafetyGate ─────────────────────────────────────────────────────────────

export class SafetyGate {
  private readonly model: ONIModel;
  private readonly protectedTools: Set<string>;
  private readonly systemPrompt: string;
  private readonly timeout: number;

  constructor(config: SafetyGateConfig) {
    this.model = config.safetyModel;
    this.protectedTools = new Set(config.protectedTools ?? DEFAULT_PROTECTED_TOOLS);
    this.systemPrompt = config.safetySystemPrompt ?? DEFAULT_SAFETY_PROMPT;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  /** Returns true if the tool requires a safety check before execution. */
  requiresCheck(toolName: string): boolean {
    return this.protectedTools.has(toolName);
  }

  /** Sends tool call info to the safety model and returns the check result. */
  async check(call: { id: string; name: string; args: Record<string, unknown> }): Promise<SafetyCheckResult> {
    let response: Awaited<ReturnType<typeof this.model.chat>>;
    try {
      const userMessage = `Tool: ${call.name}\nArguments: ${JSON.stringify(call.args, null, 2)}`;

      const responsePromise = this.model.chat({
        messages: [{ role: "user", content: userMessage }],
        systemPrompt: this.systemPrompt,
        maxTokens: 256,
      });

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("Safety check timeout")), this.timeout);
      });

      response = await Promise.race([responsePromise, timeoutPromise]);
      clearTimeout(timeoutHandle);
    } catch {
      // Fail-closed for network errors and timeouts — block destructive tools
      // when the safety service is unavailable.
      return { ...FALLBACK_RESULT };
    }

    // Safely extract text — content is typed as string but guard defensively
    // against adapters that return a content-block array at runtime.
    const text = typeof response.content === "string"
      ? response.content
      : (response.content as Array<{ text?: string }>).map((p) => p.text ?? "").join("");

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return {
        approved: Boolean(parsed["approved"]),
        reason: parsed["reason"] as string | undefined,
        riskScore: parsed["riskScore"] as number | undefined,
        suggestion: parsed["suggestion"] as string | undefined,
      };
    } catch {
      // Model returned non-JSON content — fail-closed. A safety model that
      // cannot produce a parseable response must not silently approve.
      return {
        approved: false,
        reason: "Safety check failed: model returned non-JSON response",
        riskScore: 1.0,
      };
    }
  }
}
