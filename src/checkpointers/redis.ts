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
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
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
        eval: (script, numkeys, ...args) => r.eval(script, numkeys, ...args),
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

  // ── Lua scripts ────────────────────────────────────────────

  // Atomic SET + ZADD: stores checkpoint data and updates the index in one round-trip.
  // KEYS[1] = data key, KEYS[2] = index key
  // ARGV[1] = serialized checkpoint JSON, ARGV[2] = step (used as score and member)
  private static readonly PUT_SCRIPT = `
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('ZADD', KEYS[2], tonumber(ARGV[2]), ARGV[2])
    return 'OK'
  `;

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
    await this.client.eval(
      RedisCheckpointer.PUT_SCRIPT,
      2,
      this.dataKey(cp.threadId, cp.step),
      this.idxKey(cp.threadId),
      JSON.stringify(cp),
      cp.step,
    );
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
    const idxKey = this.idxKey(threadId);
    const steps = await this.client.zrange(idxKey, 0, -1);
    const dataKeys = steps.map(s => this.dataKey(threadId, Number(s)));
    // Single atomic del() call for index + data keys to prevent
    // concurrent put() from causing inconsistency between the two.
    await this.client.del(idxKey, ...dataKeys);
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CheckpointCorruptError(
        threadId,
        "failed to parse checkpoint JSON — data may be truncated or corrupted"
      );
    }

    if (parsed === null || typeof parsed !== "object") {
      throw new CheckpointCorruptError(
        threadId,
        `invalid checkpoint — expected an object, got ${JSON.stringify(parsed)}`
      );
    }

    const cp = parsed as Record<string, unknown>;

    if (typeof cp["threadId"] !== "string") {
      throw new CheckpointCorruptError(
        threadId,
        `missing or invalid "threadId" — expected string, got ${JSON.stringify(cp["threadId"])}`
      );
    }

    const step = Number(cp["step"]);
    if (!Number.isFinite(step)) {
      throw new CheckpointCorruptError(
        threadId,
        `missing or invalid "step" — expected a finite number, got ${JSON.stringify(cp["step"])}`
      );
    }

    const timestamp = Number(cp["timestamp"]);
    if (!Number.isFinite(timestamp)) {
      throw new CheckpointCorruptError(
        threadId,
        `missing or invalid "timestamp" — expected a finite number, got ${JSON.stringify(cp["timestamp"])}`
      );
    }

    if (cp["state"] === undefined) {
      throw new CheckpointCorruptError(
        threadId,
        `missing required field "state"`
      );
    }

    if (!Array.isArray(cp["nextNodes"])) {
      throw new CheckpointCorruptError(
        threadId,
        `missing or invalid "nextNodes" — expected an array, got ${JSON.stringify(cp["nextNodes"])}`
      );
    }

    return cp as unknown as ONICheckpoint<S>;
  }
}
