// ============================================================
// @oni.bot/stores — PostgresStore
// ============================================================
// Persistent KV store backend using PostgreSQL.
// Requires `pg` as an optional peer dependency.
//
// Schema:
//   oni_store(prefix, namespace, key, value, created_at, updated_at, ttl)
//   namespace column stores JSON.stringify(string[])
// ============================================================

import { BaseStore } from "../types.js";
import type { Namespace, StoreKey, StoreItem, SearchResult } from "../types.js";
import type { PgClient } from "./types.js";

export type { PgClient } from "./types.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS oni_store (
  namespace  TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      JSONB   NOT NULL,
  created_at BIGINT  NOT NULL,
  updated_at BIGINT  NOT NULL,
  ttl        BIGINT,
  prefix     TEXT    NOT NULL DEFAULT 'default',
  PRIMARY KEY (prefix, namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_oni_store_ns ON oni_store (prefix, namespace);
`;

interface OniStoreRow {
  namespace: string;
  key: string;
  value: unknown;
  created_at: string;
  updated_at: string;
  ttl: string | null;
  prefix: string;
}

export class PostgresStore extends BaseStore {
  private constructor(
    private readonly client: PgClient,
    private readonly prefix: string,
  ) {
    super();
  }

  static async create(connectionString: string, prefix?: string): Promise<PostgresStore> {
    let client: PgClient;
    try {
      // @ts-expect-error — pg is an optional peer dependency
      const pg = await import("pg") as { default?: { Pool: new (opts: { connectionString: string }) => PgClient }; Pool?: new (opts: { connectionString: string }) => PgClient };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Pool = (pg.default?.Pool ?? pg.Pool) as any; // SAFE: external boundary — pg optional peer with variable shape
      if (!Pool) {
        throw new Error("Could not find Pool in pg module");
      }
      client = new Pool({ connectionString }) as PgClient;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
        throw new Error(
          "PostgresStore requires 'pg' to be installed. " +
          "Run: pnpm add pg"
        );
      }
      throw err;
    }

    const store = new PostgresStore(client, prefix ?? "default");
    await store.ensureSchema();
    return store;
  }

  private async ensureSchema(): Promise<void> {
    for (const stmt of SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean)) {
      await this.client.query(stmt);
    }
  }

  private nsStr(namespace: Namespace): string {
    return JSON.stringify(namespace);
  }

  private isExpired(row: OniStoreRow): boolean {
    if (row.ttl == null) return false;
    const updatedAt = Number(row.updated_at);
    const ttl = Number(row.ttl);
    return Date.now() > updatedAt + ttl;
  }

  private rowToItem<T>(row: OniStoreRow): StoreItem<T> {
    let namespace: Namespace;
    try {
      namespace = JSON.parse(row.namespace) as Namespace;
    } catch {
      namespace = [row.namespace];
    }
    return {
      namespace,
      key: row.key,
      value: row.value as T,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      ttl: row.ttl != null ? Number(row.ttl) : undefined,
    };
  }

  // ── BaseStore interface ──────────────────────────────────────

  async get<T = unknown>(namespace: Namespace, key: StoreKey): Promise<StoreItem<T> | null> {
    const result = await this.client.query(
      `SELECT namespace, key, value, created_at, updated_at, ttl, prefix
         FROM oni_store
        WHERE prefix = $1 AND namespace = $2 AND key = $3`,
      [this.prefix, this.nsStr(namespace), key]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as OniStoreRow;
    if (this.isExpired(row)) {
      // Fire-and-forget: clean up the expired row so it doesn't accumulate
      void this.client.query(
        `DELETE FROM oni_store WHERE prefix = $1 AND namespace = $2 AND key = $3`,
        [this.prefix, this.nsStr(namespace), key]
      );
      return null;
    }

    return this.rowToItem<T>(row);
  }

  async put<T = unknown>(
    namespace: Namespace,
    key: StoreKey,
    value: T,
    opts?: { ttl?: number }
  ): Promise<void> {
    const now = Date.now();

    await this.client.query(
      `INSERT INTO oni_store (prefix, namespace, key, value, created_at, updated_at, ttl)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       ON CONFLICT (prefix, namespace, key)
       DO UPDATE SET value      = EXCLUDED.value,
                     updated_at = EXCLUDED.updated_at,
                     ttl        = EXCLUDED.ttl,
                     created_at = oni_store.created_at`,
      [
        this.prefix,
        this.nsStr(namespace),
        key,
        JSON.stringify(value),
        now,
        now,
        opts?.ttl ?? null,
      ]
    );
  }

  async delete(namespace: Namespace, key: StoreKey): Promise<void> {
    await this.client.query(
      `DELETE FROM oni_store WHERE prefix = $1 AND namespace = $2 AND key = $3`,
      [this.prefix, this.nsStr(namespace), key]
    );
  }

  async list(namespace: Namespace): Promise<StoreItem[]> {
    const result = await this.client.query(
      `SELECT namespace, key, value, created_at, updated_at, ttl, prefix
         FROM oni_store
        WHERE prefix = $1 AND namespace = $2`,
      [this.prefix, this.nsStr(namespace)]
    );

    const allRows = result.rows as OniStoreRow[];
    const expiredRows = allRows.filter(row => this.isExpired(row));
    const liveRows = allRows.filter(row => !this.isExpired(row));

    // Bulk-delete expired rows so they don't accumulate
    if (expiredRows.length > 0) {
      const expiredKeys = expiredRows.map(row => row.key);
      void this.client.query(
        `DELETE FROM oni_store WHERE prefix = $1 AND namespace = $2 AND key = ANY($3)`,
        [this.prefix, this.nsStr(namespace), expiredKeys]
      );
    }

    return liveRows.map(row => this.rowToItem(row));
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
    const result = await this.client.query(
      `SELECT DISTINCT namespace FROM oni_store WHERE prefix = $1`,
      [this.prefix]
    );

    const filterPrefix = opts?.prefix ?? [];
    const maxDepth = opts?.maxDepth;

    const seen = new Set<string>();
    const namespaces: Namespace[] = [];

    for (const row of result.rows as Array<{ namespace: string }>) {
      let ns: Namespace;
      try {
        ns = JSON.parse(row.namespace) as Namespace;
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
        namespaces.push(effective);
      }
    }

    return namespaces;
  }

  /** Close the underlying pg Pool connection */
  async close(): Promise<void> {
    try {
      if (this.client.end) {
        await this.client.end();
      }
    } catch {
      // Ignore errors on close
    }
  }
}
