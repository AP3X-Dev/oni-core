// ============================================================
// @oni.bot/stores — RedisStore
// ============================================================
// Persistent KV store backend using Redis.
// Requires either `ioredis` or `redis` (v4+) as an optional peer dependency.
//
// Key scheme:
//   Data:  oni:store:{prefix}:{namespace_json}:{key}  → JSON of StoreItem
//   Index: oni:store:idx:{prefix}:{namespace_json}    → sorted set, members=keys, scores=updatedAt
// ============================================================

import { BaseStore } from "../types.js";
import type { Namespace, StoreKey, StoreItem, SearchResult } from "../types.js";
import type { RedisStoreConfig, RedisClient } from "./types.js";

export type { RedisStoreConfig } from "./types.js";

export class RedisStore extends BaseStore {
  private constructor(
    private readonly client: RedisClient,
    private readonly prefix: string,
  ) {
    super();
  }

  static async create(config: RedisStoreConfig): Promise<RedisStore> {
    let client: RedisClient;
    try {
      // Try ioredis first
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ioredis = await import("ioredis") as any; // SAFE: optional peer dep — shape verified at runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const IORedisCtor = ioredis.default ?? ioredis.Redis ?? ioredis as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = new IORedisCtor(config.url) as any;
      client = {
        set:      (k, v)          => r.set(k, v),
        get:      (k)             => r.get(k),
        del:      (...keys: string[]) => r.del(...keys),
        zadd:     (k, score, mem) => r.zadd(k, score, mem),
        zrange:   (k, start, end) => r.zrange(k, start, end),
        zrem:     (k, mem)        => r.zrem(k, mem),
        keys:     (p)             => r.keys(p),
        pexpire:  (k, ms)         => r.pexpire(k, ms),
        eval:     (script, numkeys, ...args) => r.eval(script, numkeys, ...args),
        disconnect: ()            => r.disconnect(),
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
          "RedisStore requires either 'ioredis' or 'redis' to be installed. " +
          "Run: pnpm add ioredis  OR  pnpm add redis"
        );
      }
    }
    return new RedisStore(client, config.prefix ?? "default");
  }

  // ── Key helpers ──────────────────────────────────────────────

  private dataKey(namespace: Namespace, key: StoreKey): string {
    return `oni:store:${this.prefix}:${JSON.stringify(namespace)}:${key}`;
  }

  private idxKey(namespace: Namespace): string {
    return `oni:store:idx:${this.prefix}:${JSON.stringify(namespace)}`;
  }

  private isExpired(item: StoreItem): boolean {
    if (!item.ttl) return false;
    return Date.now() > item.updatedAt + item.ttl;
  }

  // ── BaseStore interface ──────────────────────────────────────

  async get<T = unknown>(namespace: Namespace, key: StoreKey): Promise<StoreItem<T> | null> {
    const raw = await this.client.get(this.dataKey(namespace, key));
    if (raw == null) return null;

    let item: StoreItem<T>;
    try {
      item = JSON.parse(raw) as StoreItem<T>;
    } catch {
      return null;
    }

    // Double-check TTL in case Redis expiry hasn't kicked in yet
    if (this.isExpired(item as StoreItem)) return null;

    return item;
  }

  // Lua script: atomically GET existing createdAt, then SET with preserved or new createdAt.
  // KEYS[1] = data key
  // ARGV[1] = new item JSON (with createdAt = now as default)
  // ARGV[2] = TTL in ms (0 = no TTL)
  // Returns "OK"
  private static readonly PUT_SCRIPT = `
    local existing = redis.call('GET', KEYS[1])
    local newItem = ARGV[1]
    if existing then
      local ok, parsed = pcall(cjson.decode, existing)
      if ok and parsed and parsed.createdAt then
        local ok2, newParsed = pcall(cjson.decode, newItem)
        if ok2 and newParsed then
          newParsed.createdAt = parsed.createdAt
          newItem = cjson.encode(newParsed)
        end
      end
    end
    redis.call('SET', KEYS[1], newItem)
    local ttl = tonumber(ARGV[2])
    if ttl > 0 then
      redis.call('PEXPIRE', KEYS[1], ttl)
    end
    return 'OK'
  `;

  async put<T = unknown>(
    namespace: Namespace,
    key: StoreKey,
    value: T,
    opts?: { ttl?: number }
  ): Promise<void> {
    const now = Date.now();

    const item: StoreItem<T> = {
      namespace,
      key,
      value,
      createdAt: now,
      updatedAt: now,
      ttl: opts?.ttl,
    };

    const dk = this.dataKey(namespace, key);
    const ttlMs = opts?.ttl ?? 0;

    // Atomic GET + conditional createdAt preservation + SET via Lua script
    await this.client.eval(
      RedisStore.PUT_SCRIPT,
      1,
      dk,
      JSON.stringify(item),
      ttlMs,
    );

    // Update the namespace index (sorted set, score = updatedAt)
    await this.client.zadd(this.idxKey(namespace), now, key);
  }

  async delete(namespace: Namespace, key: StoreKey): Promise<void> {
    await this.client.del(this.dataKey(namespace, key));
    await this.client.zrem(this.idxKey(namespace), key);
  }

  async list(namespace: Namespace): Promise<StoreItem[]> {
    // Get all members from the index sorted set
    const members = await this.client.zrange(this.idxKey(namespace), 0, -1);
    if (members.length === 0) return [];

    const items: StoreItem[] = [];
    for (const key of members) {
      const raw = await this.client.get(this.dataKey(namespace, key));
      if (raw == null) continue; // expired or deleted

      let item: StoreItem;
      try {
        item = JSON.parse(raw) as StoreItem;
      } catch {
        continue;
      }

      if (this.isExpired(item)) continue;
      items.push(item);
    }

    return items;
  }

  async search<T = unknown>(
    namespace: Namespace,
    query: string,
    opts?: { limit?: number; filter?: Record<string, unknown> }
  ): Promise<SearchResult<T>[]> {
    let items = await this.list(namespace);

    // Apply filter if provided
    if (opts?.filter) {
      items = items.filter((item) => {
        const val = item.value;
        if (typeof val !== "object" || val === null || Array.isArray(val)) return false;
        const obj = val as Record<string, unknown>;
        return Object.entries(opts.filter!).every(([k, v]) => obj[k] === v);
      });
    }

    const lower = query.toLowerCase();
    const limit = opts?.limit ?? 10;

    return items
      .map((item) => {
        const text = JSON.stringify(item.value).toLowerCase();
        const score = text.includes(lower) ? 1 : 0;
        return { item: item as StoreItem<T>, score };
      })
      .filter((r) => r.score > 0)
      .slice(0, limit);
  }

  async listNamespaces(
    opts?: { prefix?: Namespace; maxDepth?: number }
  ): Promise<Namespace[]> {
    // Scan all index keys to extract unique namespace portions
    const pattern = `oni:store:idx:${this.prefix}:*`;
    const keys = await this.client.keys(pattern);

    const prefixStr = `oni:store:idx:${this.prefix}:`;
    const seen = new Set<string>();
    const result: Namespace[] = [];

    const filterPrefix = opts?.prefix ?? [];
    const maxDepth = opts?.maxDepth;

    for (const k of keys) {
      const nsJson = k.slice(prefixStr.length);
      let ns: Namespace;
      try {
        ns = JSON.parse(nsJson) as Namespace;
      } catch {
        continue;
      }

      // Check prefix match
      if (filterPrefix.length > 0) {
        if (ns.length < filterPrefix.length) continue;
        if (!filterPrefix.every((p, i) => ns[i] === p)) continue;
      }

      // Apply maxDepth (relative to prefix)
      const effective = maxDepth !== undefined
        ? ns.slice(0, filterPrefix.length + maxDepth)
        : ns;

      const key = JSON.stringify(effective);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(effective);
      }
    }

    return result;
  }

  /** Close the underlying Redis connection */
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
}
