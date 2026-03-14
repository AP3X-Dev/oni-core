/**
 * @oni.bot/core — Request/Reply coordination broker
 *
 * Enables request/response patterns between agents in a graph.
 * A requesting agent sends a typed payload to a target agent and
 * receives a promise that resolves when the target replies.
 */

export interface PendingRequest {
  id: string;
  from: string;
  to: string;
  payload: unknown;
  timestamp: number;
  resolved: boolean;
  response?: unknown;
}

export class RequestReplyBroker {
  private pending   = new Map<string, PendingRequest>();
  private resolvers = new Map<string, (value: unknown) => void>();
  private rejectors = new Map<string, (err: Error) => void>();
  private timeouts  = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Create a request from one agent to another.
   * Returns the request id, a promise that resolves with the reply,
   * and a message object suitable for routing through the graph.
   */
  request(
    from: string,
    to: string,
    payload: unknown,
    opts?: { timeoutMs?: number },
  ): { requestId: string; promise: Promise<unknown>; message: any } {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Serialize before mutating state — throw early if payload is non-serializable
    // so no orphaned pending entry is left behind.
    let content: string;
    try {
      content = JSON.stringify({ _type: "request", payload });
    } catch (err) {
      throw new Error(
        `RequestReply.request: payload for request ${id} is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const req: PendingRequest = {
      id,
      from,
      to,
      payload,
      timestamp: Date.now(),
      resolved: false,
    };
    this.pending.set(id, req);

    const promise = new Promise<unknown>((resolve, reject) => {
      this.resolvers.set(id, resolve);
      this.rejectors.set(id, reject);

      // Apply a timeout to prevent permanent leaks when no reply ever arrives.
      // Callers may override; the default 60s covers a full agent lifecycle.
      const timeoutMs = opts?.timeoutMs ?? 60_000;
      const handle = setTimeout(() => {
        if (!req.resolved) {
          req.resolved = true;
          this.resolvers.delete(id);
          this.rejectors.delete(id);
          this.pending.delete(id);
          this.timeouts.delete(id);
          reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.timeouts.set(id, handle);
    });

    const message = {
      id,
      from,
      to,
      content,
      metadata: { requestId: id },
      timestamp: Date.now(),
    };

    return { requestId: id, promise, message };
  }

  /**
   * Reply to a pending request, resolving the caller's promise.
   * Returns a reply message object.
   */
  reply(requestId: string, payload: unknown): any {
    const req = this.pending.get(requestId);
    if (!req) throw new Error(`No pending request with id ${requestId}`);

    // Clear the timeout handle before doing anything else
    const handle = this.timeouts.get(requestId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timeouts.delete(requestId);
    }

    req.resolved = true;
    req.response = payload;

    const resolver = this.resolvers.get(requestId);
    if (resolver) {
      resolver(payload);
      this.resolvers.delete(requestId);
      this.rejectors.delete(requestId);
    }

    // Remove from pending — completed requests must not accumulate
    this.pending.delete(requestId);

    let replyContent: string;
    try {
      replyContent = JSON.stringify({ _type: "reply", requestId, payload });
    } catch {
      replyContent = JSON.stringify({ _type: "reply", requestId, payload: "[non-serializable]" });
    }
    return {
      id: `reply_${requestId}`,
      from: req.to,
      to: req.from,
      content: replyContent,
      metadata: { requestId, isReply: true },
      timestamp: Date.now(),
    };
  }

  /** Check whether an agent has any unresolved incoming requests. */
  hasPending(agentId: string): boolean {
    for (const req of this.pending.values()) {
      if (req.to === agentId && !req.resolved) return true;
    }
    return false;
  }

  /** Return all unresolved requests targeted at the given agent. */
  getPending(agentId: string): PendingRequest[] {
    return [...this.pending.values()].filter(
      (r) => r.to === agentId && !r.resolved,
    );
  }

  /**
   * Cancel all pending request timeouts and clear internal state.
   * Call when the broker is no longer needed to allow GC.
   */
  dispose(): void {
    for (const handle of this.timeouts.values()) {
      clearTimeout(handle);
    }
    this.timeouts.clear();
    // Reject all pending promises before clearing so callers don't hang forever.
    for (const [id, reject] of this.rejectors) {
      const req = this.pending.get(id);
      if (req && !req.resolved) {
        req.resolved = true;
        reject(new Error(`Request ${id} cancelled: broker disposed`));
      }
    }
    this.rejectors.clear();
    this.resolvers.clear();
    this.pending.clear();
  }
}
