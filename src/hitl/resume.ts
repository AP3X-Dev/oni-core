// ============================================================
// @oni.bot/core/hitl — Resume & HITL Session Management
// ============================================================

import type { ONICheckpointer, ONICheckpoint } from "../types.js";
import type { InterruptValue, ResumeValue } from "./interrupt.js";

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

export class HITLSessionStore<S> {
  private sessions = new Map<string, HITLSession<S>>();

  record(
    threadId:   string,
    interrupt:  InterruptValue,
    checkpoint: ONICheckpoint<S>
  ): HITLSession<S> {
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
    return this.sessions.get(resumeId) ?? null;
  }

  getByThread(threadId: string): HITLSession<S>[] {
    return [...this.sessions.values()].filter(
      (s) => s.threadId === threadId && s.status === "pending"
    );
  }

  markResumed(resumeId: string): void {
    const s = this.sessions.get(resumeId);
    if (s) s.status = "resumed";
  }

  pendingCount(): number {
    return [...this.sessions.values()].filter((s) => s.status === "pending").length;
  }

  all(): HITLSession<S>[] {
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
