// ============================================================
// @oni.bot/core — Dead Letter Queue
// ============================================================

let _nextId = 1;

export interface DeadLetter {
  id: string;
  node: string;
  input: Record<string, unknown>;
  error: Error;
  attempts: number;
  timestamp: number;
}

export class DeadLetterQueue {
  private letters = new Map<string, DeadLetter[]>();

  record(threadId: string, node: string, input: Record<string, unknown>, error: Error, attempts: number): DeadLetter {
    const dl: DeadLetter = {
      id: `dlq-${_nextId++}`,
      node, input, error, attempts,
      timestamp: Date.now(),
    };
    if (!this.letters.has(threadId)) this.letters.set(threadId, []);
    this.letters.get(threadId)!.push(dl);
    return dl;
  }

  getAll(threadId: string): DeadLetter[] {
    return this.letters.get(threadId) ?? [];
  }

  remove(threadId: string, dlId: string): boolean {
    const list = this.letters.get(threadId);
    if (!list) return false;
    const idx = list.findIndex((dl) => dl.id === dlId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  clear(threadId: string): void {
    this.letters.delete(threadId);
  }

  size(): number {
    let total = 0;
    for (const list of this.letters.values()) total += list.length;
    return total;
  }
}
