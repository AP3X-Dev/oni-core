import type { AuditEntry } from "./types.js";

export class AuditLog {
  private logs: Map<string, AuditEntry[]> = new Map();

  record(threadId: string, entry: AuditEntry): void {
    const existing = this.logs.get(threadId) ?? [];
    existing.push(entry);
    this.logs.set(threadId, existing);
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
    const entries: AuditEntry[] = JSON.parse(json);
    this.logs.set(threadId, entries);
  }
}
