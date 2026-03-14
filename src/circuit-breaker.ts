// ============================================================
// @oni.bot/core — Circuit Breaker
// ============================================================

import { CircuitBreakerOpenError } from "./errors.js";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  threshold: number;      // consecutive failures before opening
  resetAfter: number;     // ms before OPEN → HALF_OPEN
  fallback?: (...args: unknown[]) => unknown;  // optional fallback when open
}

export class CircuitBreaker {
  private _state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private _probeInFlight = false;
  private readonly nodeName: string;

  constructor(private readonly config: CircuitBreakerConfig, nodeName?: string) {
    this.nodeName = nodeName ?? "unknown";
  }

  get state(): CircuitState {
    if (this._state === "open" && Date.now() - this.lastFailureTime >= this.config.resetAfter) {
      this._state = "half_open";
    }
    return this._state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state;
    if (currentState === "open") {
      if (this.config.fallback) return this.config.fallback() as T;
      throw new CircuitBreakerOpenError(this.nodeName, this.config.resetAfter);
    }
    if (currentState === "half_open") {
      if (this._probeInFlight) {
        // Another probe is already in flight — reject additional concurrent callers
        if (this.config.fallback) return this.config.fallback() as T;
        throw new CircuitBreakerOpenError(this.nodeName, this.config.resetAfter);
      }
      this._probeInFlight = true; // Set synchronously before any await
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this._state = "closed";
    this._probeInFlight = false;
  }

  private onFailure(): void {
    this._probeInFlight = false;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this._state === "half_open") {
      this._state = "open";
    } else if (this.consecutiveFailures >= this.config.threshold) {
      this._state = "open";
    }
  }

  reset(): void {
    this._state = "closed";
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this._probeInFlight = false;
  }
}
