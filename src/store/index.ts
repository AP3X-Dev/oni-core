// ============================================================
// @oni.bot/core/store — Cross-thread KV Store
// ============================================================
// Persists data ACROSS thread IDs. This is fundamentally
// different from checkpointing (which is per-thread).
//
// Use cases:
//   - Agent long-term memory
//   - User profiles and preferences
//   - Shared facts across conversations
//   - Agent-to-agent knowledge sharing in swarms
//
// Namespace model: (namespace[], key) → value
//   e.g. (["users", "cj"], "preferences") → { theme: "dark" }
//        (["agents", "researcher"], "facts") → [...]
// ============================================================

export type Namespace = string[];
export type StoreKey  = string;

export interface StoreItem<T = unknown> {
  namespace: Namespace;
  key:       StoreKey;
  value:     T;
  createdAt: number;
  updatedAt: number;
  /** TTL in ms — item expires after this many ms from updatedAt */
  ttl?:      number;
}

export interface SearchResult<T = unknown> {
  item:      StoreItem<T>;
  score?:    number;
}

export type EmbedFn = (text: string) => Promise<number[]>;

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: vector dimension mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ----------------------------------------------------------------
// BaseStore — abstract interface, implement for any backend
// ----------------------------------------------------------------

export abstract class BaseStore {
  abstract get<T = unknown>(
    namespace: Namespace,
    key:       StoreKey
  ): Promise<StoreItem<T> | null>;

  abstract put<T = unknown>(
    namespace: Namespace,
    key:       StoreKey,
    value:     T,
    opts?:     { ttl?: number }
  ): Promise<void>;

  abstract delete(namespace: Namespace, key: StoreKey): Promise<void>;

  abstract list(namespace: Namespace): Promise<StoreItem[]>;

  abstract search<T = unknown>(
    namespace:    Namespace,
    query:        string,
    opts?:        { limit?: number; filter?: Record<string, unknown> }
  ): Promise<SearchResult<T>[]>;

  abstract listNamespaces(
    opts?: { prefix?: Namespace; maxDepth?: number }
  ): Promise<Namespace[]>;

  /** Namespaced helper — returns a scoped accessor */
  namespace(ns: Namespace): NamespacedStore {
    return new NamespacedStore(this, ns);
  }
}

// ----------------------------------------------------------------
// InMemoryStore — full in-process implementation
// ----------------------------------------------------------------

export class InMemoryStore extends BaseStore {
  private data = new Map<string, StoreItem>();
  private readonly embedFn?: EmbedFn;
  private vectors = new Map<string, number[]>();
  private readonly maxItems: number;

  constructor(opts?: { embedFn?: EmbedFn; maxItems?: number }) {
    super();
    this.embedFn = opts?.embedFn;
    this.maxItems = opts?.maxItems ?? 10_000;
  }

  private key(namespace: Namespace, key: StoreKey): string {
    return `${JSON.stringify(namespace)}::${key}`;
  }

  private isExpired(item: StoreItem): boolean {
    if (!item.ttl) return false;
    return Date.now() > item.updatedAt + item.ttl;
  }

  async get<T = unknown>(namespace: Namespace, key: StoreKey): Promise<StoreItem<T> | null> {
    const item = this.data.get(this.key(namespace, key));
    if (!item) return null;
    if (this.isExpired(item)) {
      this.data.delete(this.key(namespace, key));
      return null;
    }
    return item as StoreItem<T>;
  }

  async put<T = unknown>(namespace: Namespace, key: StoreKey, value: T, opts?: { ttl?: number }): Promise<void> {
    const k = this.key(namespace, key);
    const existing = this.data.get(k);
    // Enforce max size — evict expired items first, then reject
    if (!existing && this.data.size >= this.maxItems) {
      this.evictExpired();
      if (this.data.size >= this.maxItems) {
        throw new Error(`InMemoryStore: max capacity reached (${this.maxItems} items). Set maxItems or add TTLs.`);
      }
    }
    const item: StoreItem = {
      namespace,
      key,
      value,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      ttl:       opts?.ttl,
    };
    this.data.set(k, item);
    // Compute embedding if configured — guard against concurrent delete() or
    // put() that may have changed or removed the key during the async gap.
    if (this.embedFn) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      let embedding: number[];
      try {
        embedding = await this.embedFn(text);
      } catch (err) {
        // Roll back the data write — but only if no concurrent put()/delete()
        // has since replaced our entry (same reference guard as the success path).
        if (this.data.get(k) === item) {
          if (existing) {
            this.data.set(k, existing);
          } else {
            this.data.delete(k);
          }
        }
        throw err;
      }
      if (this.data.get(k) === item) {
        this.vectors.set(k, embedding);
      }
    }
  }

  async delete(namespace: Namespace, key: StoreKey): Promise<void> {
    const k = this.key(namespace, key);
    this.data.delete(k);
    this.vectors.delete(k);
  }

  async list(namespace: Namespace): Promise<StoreItem[]> {
    const prefix = JSON.stringify(namespace);
    const result: StoreItem[] = [];
    for (const [k, item] of this.data) {
      if (this.isExpired(item)) {
        this.data.delete(k);
        this.vectors.delete(k);
        continue;
      }
      if (JSON.stringify(item.namespace) === prefix) result.push(item);
    }
    return result;
  }

  async search<T = unknown>(
    namespace: Namespace,
    query:     string,
    opts?:     { limit?: number; filter?: Record<string, unknown> }
  ): Promise<SearchResult<T>[]> {
    let items = await this.list(namespace);
    if (opts?.filter) {
      items = items.filter((item) => {
        const val = item.value;
        if (typeof val !== "object" || val === null || Array.isArray(val)) return false;
        const obj = val as Record<string, unknown>;
        return Object.entries(opts.filter!).every(([k, v]) => obj[k] === v);
      });
    }
    const limit = opts?.limit ?? 10;

    if (this.embedFn) {
      const queryVec = await this.embedFn(query);
      const scored = items
        .map((item) => {
          const k = this.key(item.namespace, item.key);
          const vec = this.vectors.get(k);
          const score = vec ? cosine(queryVec, vec) : 0;
          return { item: item as StoreItem<T>, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return scored;
    }

    // Fallback: substring match
    const lower = query.toLowerCase();
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
    const seen = new Set<string>();
    const result: Namespace[] = [];
    const prefix = opts?.prefix ?? [];
    const maxDepth = opts?.maxDepth;

    for (const [k, item] of this.data) {
      if (this.isExpired(item)) {
        this.data.delete(k);
        this.vectors.delete(k);
        continue;
      }
      const ns = item.namespace;
      // Check prefix match
      if (prefix.length > 0) {
        if (ns.length < prefix.length) continue;
        if (!prefix.every((p, i) => ns[i] === p)) continue;
      }
      // Apply maxDepth (relative to prefix)
      const effective = maxDepth !== undefined
        ? ns.slice(0, prefix.length + maxDepth)
        : ns;
      const key = JSON.stringify(effective);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(effective);
      }
    }
    return result;
  }

  /** Alias for put() — common Map-like convention */
  set<T = unknown>(namespace: Namespace, key: StoreKey, value: T, opts?: { ttl?: number }): Promise<void> {
    return this.put(namespace, key, value, opts);
  }

  /** Number of non-expired items — also purges expired entries from memory */
  size(): number {
    let count = 0;
    for (const [k, item] of this.data) {
      if (this.isExpired(item)) {
        this.data.delete(k);
        this.vectors.delete(k);
      } else {
        count++;
      }
    }
    return count;
  }

  clear(): void { this.data.clear(); this.vectors.clear(); }

  private evictExpired(): void {
    for (const [k, item] of this.data) {
      if (this.isExpired(item)) {
        this.data.delete(k);
        this.vectors.delete(k);
      }
    }
  }
}

// ----------------------------------------------------------------
// NamespacedStore — scoped accessor for a specific namespace
// ----------------------------------------------------------------

export class NamespacedStore {
  constructor(
    private readonly store: BaseStore,
    private readonly ns:    Namespace
  ) {}

  get<T>(key: StoreKey): Promise<StoreItem<T> | null> {
    return this.store.get<T>(this.ns, key);
  }

  put<T>(key: StoreKey, value: T, opts?: { ttl?: number }): Promise<void> {
    return this.store.put<T>(this.ns, key, value, opts);
  }

  delete(key: StoreKey): Promise<void> {
    return this.store.delete(this.ns, key);
  }

  list(): Promise<StoreItem[]> {
    return this.store.list(this.ns);
  }

  search<T>(query: string, opts?: { limit?: number; filter?: Record<string, unknown> }): Promise<SearchResult<T>[]> {
    return this.store.search<T>(this.ns, query, opts);
  }

  listNamespaces(opts?: { prefix?: Namespace; maxDepth?: number }): Promise<Namespace[]> {
    return this.store.listNamespaces({
      prefix: [...this.ns, ...(opts?.prefix ?? [])],
      maxDepth: opts?.maxDepth,
    });
  }

  /** Alias for put() — common Map-like convention */
  set<T>(key: StoreKey, value: T, opts?: { ttl?: number }): Promise<void> {
    return this.put(key, value, opts);
  }

  /** Sub-namespace: users.namespace(["cj"]) → users/cj scope */
  namespace(sub: Namespace): NamespacedStore {
    return new NamespacedStore(this.store, [...this.ns, ...sub]);
  }
}

// ----------------------------------------------------------------
// Convenience: agent memory store
// ----------------------------------------------------------------

export class AgentMemoryStore {
  private store: NamespacedStore;

  constructor(baseStore: BaseStore, agentId: string) {
    this.store = baseStore.namespace(["agents", agentId]);
  }

  async remember(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.store.put(key, value, { ttl });
  }

  async recall<T = unknown>(key: string): Promise<T | null> {
    const item = await this.store.get<T>(key);
    return item?.value ?? null;
  }

  async forget(key: string): Promise<void> {
    await this.store.delete(key);
  }

  async recallAll(): Promise<StoreItem[]> {
    return this.store.list();
  }

  async search<T = unknown>(query: string, limit = 5): Promise<T[]> {
    const results = await this.store.search<T>(query, { limit });
    return results.map((r) => r.item.value);
  }
}
