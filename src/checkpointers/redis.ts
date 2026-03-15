// ============================================================
// @oni.bot/core — Redis Checkpointer
// ============================================================
// Production-grade checkpointer using Redis.
// Requires either `ioredis` or `redis` (v4+) as an optional peer dependency.
// ============================================================

import type { ONICheckpoint, ONICheckpointer, CheckpointListOptions } from "../types.js";
import { CheckpointCorruptError } from "../errors.js";

interface RedisClient {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrange(key: string, start: number | string, stop: number | string): Promise<string[]>;
  zrangebyscore?(key: string, min: number, max: number): Promise<string[]>;
  keys(pattern: string): Promise<string[]>;
  quit?(): Promise<unknown>;
  disconnect?(): Promise<unknown>;
}

export interface RedisCheckpointerConfig {
  url: string;
  prefix?: string;
}

export class RedisCheckpointer<S> implements ONICheckpointer<S> {
  private constructor(
    private readonly client: RedisClient,
    private readonly prefix: string,
  ) {}

  static async create<S>(config: RedisCheckpointerConfig): Promise<RedisCheckpointer<S>> {
    let client: RedisClient;
    try {
      // Try ioredis first
      const ioredis = await import("ioredis");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RedisClass = (ioredis.default ?? ioredis) as any; // SAFE: external boundary — ioredis module shape varies by version
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = new RedisClass(config.url) as any;
      client = {
        set: (k, v) => r.set(k, v),
        get: (k) => r.get(k),
        del: (...keys) => r.del(...keys),
        zadd: (k, score, member) => r.zadd(k, score, member),
        zrange: (k, start, stop) =>
          r.zrange(k, start as number, stop as number),
        keys: (p) => r.keys(p),
        disconnect: () => r.disconnect(),
      };
    } catch {
      try {
        // Fallback: redis v4
        // @ts-expect-error — redis is an optional peer dependency
        const { createClient } = await import("redis") as {
          createClient: (opts: { url: string }) => RedisClient & { connect(): Promise<void> };
        };
        const r = createClient({ url: config.url });
        await r.connect();
        client = r;
      } catch {
        throw new Error(
          "RedisCheckpointer requires either 'ioredis' or 'redis' to be installed. " +
          "Run: pnpm add ioredis  OR  pnpm add redis"
        );
      }
    }
    return new RedisCheckpointer<S>(client, config.prefix ?? "default");
  }

  // ── Key helpers ──────────────────────────────────────────────

  private dataKey(threadId: string, step: number): string {
    return `oni:cp:${this.prefix}:${threadId}:${step}`;
  }

  private idxKey(threadId: string): string {
    return `oni:cp:idx:${this.prefix}:${threadId}`;
  }

  // ── ONICheckpointer interface ────────────────────────────────

  async get(threadId: string): Promise<ONICheckpoint<S> | null> {
    // Get all steps ascending, take the last (highest score = latest step)
    const steps = await this.client.zrange(this.idxKey(threadId), 0, -1);
    if (steps.length === 0) return null;

    const step = Number(steps[steps.length - 1]);
    const raw = await this.client.get(this.dataKey(threadId, step));
    if (raw == null) return null;

    return this.deserialize(threadId, raw);
  }

  async put(cp: ONICheckpoint<S>): Promise<void> {
    await this.client.set(this.dataKey(cp.threadId, cp.step), JSON.stringify(cp));
    await this.client.zadd(this.idxKey(cp.threadId), cp.step, String(cp.step));
  }

  async list(threadId: string, opts?: CheckpointListOptions): Promise<ONICheckpoint<S>[]> {
    // Get all steps in ascending order
    const steps = await this.client.zrange(this.idxKey(threadId), 0, -1);
    if (steps.length === 0) return [];

    const checkpoints: ONICheckpoint<S>[] = [];
    for (const stepStr of steps) {
      const step = Number(stepStr);

      // Apply before filter at fetch time to skip unnecessary gets
      if (opts?.before !== undefined && step >= opts.before) continue;

      const raw = await this.client.get(this.dataKey(threadId, step));
      if (raw == null) continue;

      checkpoints.push(this.deserialize(threadId, raw));
    }

    // Apply metadata filter
    let items = checkpoints;
    if (opts?.filter) {
      items = items.filter(c => {
        if (!c.metadata) return false;
        return Object.entries(opts.filter!).every(([k, v]) => c.metadata![k] === v);
      });
    }

    if (opts?.limit !== undefined) {
      items = items.slice(0, opts.limit);
    }

    return items;
  }

  async delete(threadId: string): Promise<void> {
    const steps = await this.client.zrange(this.idxKey(threadId), 0, -1);
    const dataKeys = steps.map(s => this.dataKey(threadId, Number(s)));
    if (dataKeys.length > 0) {
      await this.client.del(...dataKeys);
    }
    await this.client.del(this.idxKey(threadId));
  }

  async close(): Promise<void> {
    try {
      if (this.client.disconnect) {
        await this.client.disconnect();
      } else if (this.client.quit) {
        await this.client.quit();
      }
    } catch {
      // Ignore errors on close
    }
  }

  // ── Deserialization ──────────────────────────────────────────

  private deserialize(threadId: string, raw: string): ONICheckpoint<S> {
    try {
      return JSON.parse(raw) as ONICheckpoint<S>;
    } catch {
      throw new CheckpointCorruptError(
        threadId,
        "failed to parse checkpoint JSON — data may be truncated or corrupted"
      );
    }
  }
}
