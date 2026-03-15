// ============================================================
// @oni.bot/stores — Local type definitions
// ============================================================
// Mirrors the BaseStore interface from @oni.bot/core to avoid
// build-time circular dependencies between packages.
// ============================================================

export type Namespace = string[];
export type StoreKey = string;

export interface StoreItem<T = unknown> {
  namespace: Namespace;
  key: StoreKey;
  value: T;
  createdAt: number;
  updatedAt: number;
  /** TTL in ms — item expires after this many ms from updatedAt */
  ttl?: number;
}

export interface SearchResult<T = unknown> {
  item: StoreItem<T>;
  score?: number;
}

export abstract class BaseStore {
  abstract get<T = unknown>(namespace: Namespace, key: StoreKey): Promise<StoreItem<T> | null>;
  abstract put<T = unknown>(namespace: Namespace, key: StoreKey, value: T, opts?: { ttl?: number }): Promise<void>;
  abstract delete(namespace: Namespace, key: StoreKey): Promise<void>;
  abstract list(namespace: Namespace): Promise<StoreItem[]>;
  abstract search<T = unknown>(
    namespace: Namespace,
    query: string,
    opts?: { limit?: number; filter?: Record<string, unknown> }
  ): Promise<SearchResult<T>[]>;
  abstract listNamespaces(opts?: { prefix?: Namespace; maxDepth?: number }): Promise<Namespace[]>;
}
