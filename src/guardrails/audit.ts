import type { AuditEntry } from "./types.js";

export class AuditLog {
  private readonly logs: Map<string, AuditEntry[]> = new Map();
  /** Maximum number of thread IDs retained before the oldest is evicted. */
  private readonly maxThreadIds: number;

  constructor(maxThreadIds = 1_000) {
    this.maxThreadIds = maxThreadIds;
  }

  record(threadId: string, entry: AuditEntry): void {
    const existing = this.logs.get(threadId) ?? [];
    existing.push(entry);
    this.logs.set(threadId, existing);
    // Evict the oldest thread entry once the cap is exceeded.
    // Map preserves insertion order, so the first key is the oldest.
    if (this.logs.size > this.maxThreadIds) {
      const oldest = this.logs.keys().next().value as string;
      this.logs.delete(oldest);
    }
  }

  getLog(threadId: string): AuditEntry[] {
    return this.logs.get(threadId) ?? [];
  }

  getByAgent(threadId: string, agent: string): AuditEntry[] {
    return this.getLog(threadId).filter(e => e.agent === agent);
  }

  getByAction(threadId: string, action: AuditEntry["action"]): AuditEntry[] {
    return this.getLog(threadId).filter(e => e.action === action);
  }

  clear(threadId: string): void {
    this.logs.delete(threadId);
  }

  clearAll(): void {
    this.logs.clear();
  }

  toJSON(threadId: string): string {
    return JSON.stringify(this.getLog(threadId));
  }

  fromJSON(threadId: string, json: string): void {
    const safeThreadId = threadId.replace(/[^\w\-.:]/g, "_");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new Error(
        `AuditLog.fromJSON: failed to parse log for threadId "${safeThreadId}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(
        `AuditLog.fromJSON: expected array for threadId "${safeThreadId}", got ${typeof parsed}`
      );
    }
    const VALID_ACTIONS = new Set([
      "llm.request", "llm.response", "tool.call", "tool.result",
      "filter.blocked", "filter.redacted", "budget.warning", "budget.exceeded", "budget.unknown_pricing",
    ]);
    const entries: AuditEntry[] = [];
    for (const entry of parsed) {
      if (
        entry == null ||
        typeof entry !== "object" ||
        Object.prototype.hasOwnProperty.call(entry, "__proto__") ||
        typeof (entry as AuditEntry).timestamp !== "number" ||
        typeof (entry as AuditEntry).agent !== "string" ||
        !VALID_ACTIONS.has((entry as AuditEntry).action)
      ) {
        continue; // skip malformed or suspicious entries
      }
      entries.push(entry as AuditEntry);
    }
    this.logs.set(threadId, entries);
  }
}
