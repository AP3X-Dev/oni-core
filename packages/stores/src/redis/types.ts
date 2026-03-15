// ============================================================
// @oni.bot/stores — Redis backend types
// ============================================================

export interface RedisStoreConfig {
  /** Redis connection URL, e.g. redis://localhost:6379 */
  url: string;
  /** Key prefix for namespacing within the Redis instance */
  prefix?: string;
  /** Default TTL in ms — applied when item has ttl set */
  defaultTTL?: number;
}

/** Minimal Redis client interface — satisfied by both ioredis and redis v4 */
export interface RedisClient {
  set(key: string, value: string): Promise<unknown>;
  setex?(key: string, seconds: number, value: string): Promise<unknown>;
  pexpire?(key: string, ms: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrange(key: string, start: number | string, stop: number | string): Promise<string[]>;
  zrem(key: string, member: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  quit?(): Promise<unknown>;
  disconnect?(): Promise<unknown>;
}
