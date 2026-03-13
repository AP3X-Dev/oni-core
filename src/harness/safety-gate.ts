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
  approved: true,
  reason: "Safety check skipped (timeout/error)",
  riskScore: 0.1,
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
    try {
      const userMessage = `Tool: ${call.name}\nArguments: ${JSON.stringify(call.args, null, 2)}`;

      const responsePromise = this.model.chat({
        messages: [{ role: "user", content: userMessage }],
        systemPrompt: this.systemPrompt,
        maxTokens: 256,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Safety check timeout")), this.timeout);
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);
      const parsed = JSON.parse(response.content as string);

      return {
        approved: Boolean(parsed.approved),
        reason: parsed.reason,
        riskScore: parsed.riskScore,
        suggestion: parsed.suggestion,
      };
    } catch {
      return { ...FALLBACK_RESULT };
    }
  }
}
