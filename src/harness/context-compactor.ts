// ============================================================
// @oni.bot/core/harness — ContextCompactor
// Monitors token usage and compacts conversation history
// before context quality degrades (triggers at 68% by default).
// ============================================================

import type { ONIModel, ONIModelMessage } from "../models/types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CompactionBudgetSnapshot {
  estimatedTokens: number;
  percentUsed: number;
  threshold: number;
  maxTokens: number;
}

export interface CompactionCheck extends CompactionBudgetSnapshot {
  needed: boolean;
}

export interface CompactorConfig {
  /** Model used to generate the summary (typically a fast/cheap model) */
  summaryModel: ONIModel;

  /**
   * Usage fraction at which compaction triggers.
   * Research: performance degrades non-linearly above 65%.
   * @default 0.68
   */
  threshold?: number;

  /**
   * Maximum token budget for the context window.
   * @default 200_000
   */
  maxTokens?: number;

  /**
   * Approximate characters per token for estimation.
   * @default 4
   */
  charsPerToken?: number;

  /**
   * Additional instructions included in the summarization prompt.
   */
  compactInstructions?: string;
}

// ─── ContextCompactor ────────────────────────────────────────────────────────

export class ContextCompactor {
  private readonly summaryModel: ONIModel;
  private readonly threshold: number;
  private readonly maxTokens: number;
  private readonly charsPerToken: number;
  private readonly compactInstructions?: string;

  constructor(config: CompactorConfig) {
    this.summaryModel = config.summaryModel;
    this.threshold = config.threshold ?? 0.68;
    this.maxTokens = config.maxTokens ?? 200_000;
    this.charsPerToken = config.charsPerToken ?? 4;
    this.compactInstructions = config.compactInstructions;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Estimate token count from total character length of all messages.
   * Uses ceiling to avoid underestimation.
   */
  estimateTokens(messages: ONIModelMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += this.contentLength(msg);
    }
    return Math.ceil(totalChars / this.charsPerToken);
  }

  /**
   * Returns true when estimated usage exceeds the compaction threshold.
   */
  shouldCompact(messages: ONIModelMessage[]): boolean {
    return this.usageFraction(messages) >= this.threshold;
  }

  /**
   * Check if compaction is needed and return details.
   */
  checkCompaction(messages: ONIModelMessage[]): CompactionCheck {
    const budget = this.getBudgetSnapshot(messages);
    return {
      ...budget,
      needed: budget.percentUsed >= budget.threshold,
    };
  }

  /**
   * Current usage as a fraction of maxTokens (0–1+).
   */
  usageFraction(messages: ONIModelMessage[]): number {
    if (messages.length === 0) return 0;
    return this.estimateTokens(messages) / this.maxTokens;
  }

  getThreshold(): number {
    return this.threshold;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  getBudgetSnapshot(messages: ONIModelMessage[]): CompactionBudgetSnapshot {
    const estimatedTokens = this.estimateTokens(messages);
    return {
      estimatedTokens,
      percentUsed: this.maxTokens > 0 ? estimatedTokens / this.maxTokens : 0,
      threshold: this.threshold,
      maxTokens: this.maxTokens,
    };
  }

  /**
   * Two-stage compaction:
   * 1. Clear old tool results (less lossy)
   * 2. Full summarization if still over threshold
   *
   * Returns the compacted message array.
   */
  async compact(messages: ONIModelMessage[], opts?: { skipInitialCheck?: boolean }): Promise<ONIModelMessage[]> {
    if (!opts?.skipInitialCheck && !this.shouldCompact(messages)) {
      return messages;
    }

    // Stage 1: clear old tool results
    const cleaned = this.clearOldToolResults(messages);
    if (!this.shouldCompact(cleaned)) {
      return cleaned;
    }

    // Stage 2: full summarization
    try {
      return await this.summarize(cleaned);
    } catch {
      // Fallback: keep recent messages to preserve context
      return this.fallbackTruncation(cleaned);
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Remove tool-role messages from the older portion of the conversation,
   * keeping the most recent `keepRecent` messages intact.
   */
  private clearOldToolResults(
    messages: ONIModelMessage[],
    keepRecent = 10,
  ): ONIModelMessage[] {
    if (messages.length <= keepRecent) {
      return messages;
    }

    const cutoff = messages.length - keepRecent;
    const olderPortion = messages.slice(0, cutoff);
    const recentPortion = messages.slice(cutoff);

    const filteredOlder = olderPortion.filter((m) => m.role !== "tool");

    return [...filteredOlder, ...recentPortion];
  }

  /**
   * Build a history text from all messages and ask the summary model
   * to produce a compact summary wrapped in <summary> tags.
   */
  private async summarize(
    messages: ONIModelMessage[],
  ): Promise<ONIModelMessage[]> {
    const historyText = messages
      .map((m) => {
        const text =
          typeof m.content === "string"
            ? m.content
            : m.content
                .map((p) => p.text ?? "[image]")
                .join(" ");
        return `[${m.role}]: ${text}`;
      })
      .join("\n");

    const instructions = this.compactInstructions
      ? `\n\nAdditional instructions: ${this.compactInstructions}`
      : "";

    const systemMessage: ONIModelMessage = {
      role: "user",
      content:
        `Summarize the following conversation history into a concise summary. ` +
        `Preserve key decisions, code context, file paths, and task progress. ` +
        `Current state and Files modified should be preserved verbatim when possible. ` +
        `Wrap your summary in <summary></summary> tags.${instructions}\n\n` +
        `--- CONVERSATION HISTORY ---\n${historyText}`,
    };

    const response = await this.summaryModel.chat({
      messages: [systemMessage],
      maxTokens: 2048,
    });

    const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(response.content);
    const summaryText = summaryMatch
      ? summaryMatch[1].trim()
      : response.content.trim();

    return [
      {
        role: "user",
        content:
          `[Previous conversation was compacted. Summary of prior context]\n\n${summaryText}`,
      },
      {
        role: "assistant",
        content: "Context loaded.",
      },
    ];
  }

  /**
   * Fallback when the summary model fails — keep the most recent messages
   * that fit within the token budget and prepend a truncation notice.
   */
  private fallbackTruncation(messages: ONIModelMessage[]): ONIModelMessage[] {
    const budget = Math.floor(this.maxTokens * this.threshold * this.charsPerToken);
    const kept: ONIModelMessage[] = [];
    let totalChars = 0;

    // Walk backwards to keep the most recent messages that fit in the budget
    for (let i = messages.length - 1; i >= 0; i--) {
      const len = this.contentLength(messages[i]);
      if (totalChars + len > budget) break;
      totalChars += len;
      kept.unshift(messages[i]);
    }

    return [
      {
        role: "user",
        content:
          "[The previous conversation was truncated due to context limits. " +
          "Please continue from where we left off.]",
      },
      {
        role: "assistant",
        content: "Context loaded.",
      },
      ...kept,
    ];
  }

  /**
   * Get the character length of a message's content.
   */
  private contentLength(msg: ONIModelMessage): number {
    if (typeof msg.content === "string") {
      return msg.content.length;
    }
    let len = 0;
    for (const part of msg.content) {
      if (part.text) {
        len += part.text.length;
      }
    }
    return len;
  }
}
