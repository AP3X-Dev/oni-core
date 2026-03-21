// ============================================================
// @oni.bot/core/hitl — Resume & HITL Session Management
// ============================================================

import type { ONICheckpoint } from "../types.js";
import type { InterruptValue } from "./interrupt.js";

// ----------------------------------------------------------------
// HITLSession — manages a paused execution waiting for human input
// ----------------------------------------------------------------

export interface HITLSession<S> {
  threadId:   string;
  resumeId:   string;
  node:       string;
  interrupt:  InterruptValue;
  checkpoint: ONICheckpoint<S>;
  createdAt:  number;
  status:     "pending" | "resumed" | "expired";
}

/** Default TTL for pending sessions: 5 minutes. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class HITLSessionStore<S> {
  private sessions = new Map<string, HITLSession<S>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Lazily evict sessions that have exceeded the TTL.
   * Pending sessions transition to "expired" then are removed.
   * Resumed sessions are removed only after TTL — they remain visible via
   * get() and all() until they age out, so callers can observe the final
   * status without a race between markResumed() and the next get().
   */
  private evict(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.status === "pending" && now - s.createdAt > this.ttlMs) {
        s.status = "expired";
        this.sessions.delete(id);
      } else if (s.status === "resumed" && now - s.createdAt > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }

  record(
    threadId:   string,
    interrupt:  InterruptValue,
    checkpoint: ONICheckpoint<S>
  ): HITLSession<S> {
    // Evict completed and expired sessions lazily — keeps memory bounded
    // without breaking callers that read a session before the next record().
    this.evict();
    const session: HITLSession<S> = {
      threadId,
      resumeId:  interrupt.resumeId,
      node:      interrupt.node,
      interrupt,
      checkpoint,
      createdAt: Date.now(),
      status:    "pending",
    };
    this.sessions.set(interrupt.resumeId, session);
    return session;
  }

  get(resumeId: string): HITLSession<S> | null {
    this.evict();
    return this.sessions.get(resumeId) ?? null;
  }

  getByThread(threadId: string): HITLSession<S>[] {
    this.evict();
    return [...this.sessions.values()].filter(
      (s) => s.threadId === threadId && s.status === "pending"
    );
  }

  markResumed(resumeId: string): void {
    this.evict();
    const s = this.sessions.get(resumeId);
    if (s) s.status = "resumed";
  }

  pendingCount(): number {
    this.evict();
    return [...this.sessions.values()].filter((s) => s.status === "pending").length;
  }

  all(): HITLSession<S>[] {
    this.evict();
    return [...this.sessions.values()];
  }
}

// ----------------------------------------------------------------
// Pending interrupt surface — what callers catch
// ----------------------------------------------------------------

export class HITLInterruptException<S = unknown> {
  readonly isHITLInterrupt = true;

  constructor(
    public readonly threadId:  string,
    public readonly interrupt: InterruptValue,
    public readonly state:     S
  ) {}

  /** Convenience: was this a getUserInput request? */
  get isUserInputRequest(): boolean {
    return (
      typeof this.interrupt.value === "object" &&
      this.interrupt.value !== null &&
      (this.interrupt.value as Record<string,unknown>).__type === "user_input_request"
    );
  }

  get prompt(): string | undefined {
    if (!this.isUserInputRequest) return undefined;
    return (this.interrupt.value as Record<string,unknown>).prompt as string;
  }

  get inputType(): string | undefined {
    if (!this.isUserInputRequest) return undefined;
    return (this.interrupt.value as Record<string,unknown>).inputType as string;
  }

  get choices(): string[] | undefined {
    if (!this.isUserInputRequest) return undefined;
    return (this.interrupt.value as Record<string,unknown>).choices as string[];
  }
}
