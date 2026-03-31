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
  private _lastSummary: string | null = null;
  /** Promise-chain lock: serializes concurrent calls to compact(). */
  private _lockChain: Promise<void> = Promise.resolve();

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
   * Returns the text of the last compaction summary, or null if compaction
   * has not been run in this session.
   */
  getLastSummary(): string | null {
    return this._lastSummary;
  }

  /**
   * Extracts open threads / unresolved tasks from the last summary.
   * Looks for lines containing open-ended markers (TODO, WIP, pending, unresolved,
   * open, in progress) and returns them as a deduplicated string array.
   * Returns [] if no summary has been produced.
   */
  getOpenThreads(): string[] {
    if (!this._lastSummary) return [];
    const markers = /\b(TODO|WIP|pending|unresolved|open|in[- ]progress|incomplete|blocked)\b/i;
    const lines = this._lastSummary.split("\n");
    const threads: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && markers.test(trimmed)) {
        threads.push(trimmed);
      }
    }
    return [...new Set(threads)];
  }

  /**
   * Two-stage compaction:
   * 1. Clear old tool results (less lossy)
   * 2. Full summarization if still over threshold
   *
   * Returns the compacted message array.
   */
  async compact(messages: ONIModelMessage[], opts?: { skipInitialCheck?: boolean }): Promise<ONIModelMessage[]> {
    // Chain onto the lock so only one compaction pass runs at a time.
    // Each caller awaits the previous chain link before executing.
    const result = this._lockChain.then(async () => {
      if (!opts?.skipInitialCheck && !this.shouldCompact(messages)) {
        return messages;
      }
      return this._runCompaction(messages);
    });

    // Extend the chain; swallow errors so a failed compaction doesn't
    // permanently block subsequent calls.
    this._lockChain = result.then(() => {}, () => {});

    return result;
  }

  private async _runCompaction(messages: ONIModelMessage[]): Promise<ONIModelMessage[]> {
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

    // Collect IDs of tool-result messages that are in olderPortion (being removed).
    const removedToolCallIds = new Set<string>();
    for (const m of olderPortion) {
      if (m.role === "tool" && m.toolCallId) {
        removedToolCallIds.add(m.toolCallId);
      }
    }

    // For assistant+toolCalls messages whose results span both portions:
    // the assistant must be kept (some results survive in recentPortion), and
    // its tool results in olderPortion must also be kept to avoid producing an
    // incomplete tool-call sequence that both Anthropic and OpenAI reject.
    //
    // keptToolCallIds: tool result IDs in olderPortion that must be retained
    // because their parent assistant message will be kept.
    const keptToolCallIds = new Set<string>();
    for (const m of olderPortion) {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const allRemoved = m.toolCalls.every((tc) => removedToolCallIds.has(tc.id));
        if (!allRemoved) {
          // This assistant message is kept — retain its olderPortion tool results too.
          for (const tc of m.toolCalls) {
            if (removedToolCallIds.has(tc.id)) {
              keptToolCallIds.add(tc.id);
            }
          }
        }
      }
    }

    // Filter: remove tool messages unless their parent assistant is kept,
    // and remove assistant messages only when ALL their results are removed.
    const filteredOlder = olderPortion.filter((m) => {
      if (m.role === "tool") {
        return m.toolCallId ? keptToolCallIds.has(m.toolCallId) : false;
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        if (m.toolCalls.every((tc) => removedToolCallIds.has(tc.id))) return false;
      }
      return true;
    });

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
    const summaryText = summaryMatch?.[1]?.trim() ?? response.content.trim();

    this._lastSummary = summaryText;

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
      const msg = messages[i];
      if (!msg) continue;
      const len = this.contentLength(msg);
      if (totalChars + len > budget) {
        // If this is the most recent message (first one we examine) and nothing
        // has been kept yet, truncate it to fit rather than dropping it entirely
        // so the agent retains at least some context.
        if (kept.length === 0 && budget > 0) {
          const remaining = budget - totalChars;
          const suffix = " [truncated]";
          const allowedChars = Math.max(0, remaining - suffix.length);
          let truncatedMsg: ONIModelMessage;
          if (typeof msg.content === "string") {
            truncatedMsg = { ...msg, content: msg.content.slice(0, allowedChars) + suffix };
          } else {
            // For array content, truncate the text of the last text part
            const parts = msg.content.map((p, idx, arr) => {
              if (idx === arr.length - 1 && p.text) {
                return { ...p, text: p.text.slice(0, allowedChars) + suffix };
              }
              return p;
            });
            truncatedMsg = { ...msg, content: parts };
          }
          console.warn(
            `[ContextCompactor] fallbackTruncation: most recent message exceeded budget (${len} chars > ${budget} remaining); truncating to ${allowedChars} chars.`
          );
          kept.unshift(truncatedMsg);
        }
        break;
      }
      totalChars += len;
      kept.unshift(msg);
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
    let len = 0;
    if (typeof msg.content === "string") {
      len = msg.content.length;
    } else {
      for (const part of msg.content) {
        if (part.text) {
          len += part.text.length;
        }
      }
    }
    // Account for tool calls payload (function names + JSON arguments)
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        len += tc.name.length;
        len += JSON.stringify(tc.args).length;
      }
    }
    return len;
  }
}
