// ============================================================
// @oni.bot/core — SQLite Checkpointer
// ============================================================
// Persistent on-disk checkpointing via better-sqlite3.
//
//   npm install better-sqlite3
//   npm install -D @types/better-sqlite3
// ============================================================

import type { ONICheckpoint, ONICheckpointer, CheckpointListOptions } from "../types.js";
import { CheckpointCorruptError } from "../errors.js";

type Database = {
  prepare: (sql: string) => { run: (...a: unknown[]) => void; get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] };
  exec:  (sql: string) => void;
  close: () => void;
};

export class SqliteCheckpointer<S> implements ONICheckpointer<S> {
  private constructor(private readonly db: Database) {}

  static async create<S>(dbPath: string): Promise<SqliteCheckpointer<S>> {
    let DB: new (p: string) => Database;
    try {
      const mod = await import("better-sqlite3" as string);
      DB = mod.default ?? mod;
    } catch {
      throw new Error("SqliteCheckpointer requires: npm install better-sqlite3");
    }
    const db = new DB(dbPath);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS oni_checkpoints (
        thread_id     TEXT    NOT NULL,
        step          INTEGER NOT NULL,
        agent_id      TEXT,
        state         TEXT    NOT NULL,
        next_nodes    TEXT    NOT NULL,
        pending_sends  TEXT    NOT NULL DEFAULT '[]',
        metadata       TEXT    DEFAULT NULL,
        pending_writes TEXT    DEFAULT NULL,
        timestamp      INTEGER NOT NULL,
        PRIMARY KEY (thread_id, step)
      );
      CREATE INDEX IF NOT EXISTS idx_thread ON oni_checkpoints (thread_id);
    `);
    return new SqliteCheckpointer<S>(db);
  }

  async get(threadId: string): Promise<ONICheckpoint<S> | null> {
    const row = this.db
      .prepare("SELECT * FROM oni_checkpoints WHERE thread_id=? ORDER BY step DESC LIMIT 1")
      .get(threadId) as Record<string, unknown> | undefined;
    return row ? this.deserialize(row) : null;
  }

  async put(cp: ONICheckpoint<S>): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO oni_checkpoints
        (thread_id, step, agent_id, state, next_nodes, pending_sends, metadata, pending_writes, timestamp)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(cp.threadId, cp.step, cp.agentId ?? null,
       JSON.stringify(cp.state), JSON.stringify(cp.nextNodes),
       JSON.stringify(cp.pendingSends ?? []),
       cp.metadata ? JSON.stringify(cp.metadata) : null,
       cp.pendingWrites ? JSON.stringify(cp.pendingWrites) : null,
       cp.timestamp);
  }

  async list(threadId: string, opts?: CheckpointListOptions): Promise<ONICheckpoint<S>[]> {
    let sql = "SELECT * FROM oni_checkpoints WHERE thread_id=?";
    const params: unknown[] = [threadId];

    if (opts?.before !== undefined) {
      sql += " AND step < ?";
      params.push(opts.before);
    }

    sql += " ORDER BY step ASC";

    if (opts?.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }

    let items = (this.db.prepare(sql).all(...params) as Record<string, unknown>[])
      .map(r => this.deserialize(r));

    if (opts?.filter) {
      items = items.filter(c => {
        if (!c.metadata) return false;
        return Object.entries(opts.filter!).every(([k, v]) => c.metadata![k] === v);
      });
    }

    return items;
  }

  async delete(threadId: string): Promise<void> {
    this.db.prepare("DELETE FROM oni_checkpoints WHERE thread_id=?").run(threadId);
  }

  async getAt(threadId: string, step: number): Promise<ONICheckpoint<S> | null> {
    const row = this.db.prepare("SELECT * FROM oni_checkpoints WHERE thread_id=? AND step=?").get(threadId, step) as Record<string, unknown> | undefined;
    return row ? this.deserialize(row) : null;
  }

  close(): void { this.db.close(); }

  private deserialize(row: Record<string, unknown>): ONICheckpoint<S> {
    const threadId = row["thread_id"] as string;
    const safeParse = <T>(field: string, raw: unknown): T => {
      try {
        return JSON.parse(raw as string) as T;
      } catch {
        throw new CheckpointCorruptError(threadId, `failed to parse "${field}" — data may be truncated or corrupted`);
      }
    };

    const step = Number(row["step"]);
    const timestamp = Number(row["timestamp"]);
    if (!Number.isFinite(step) || !Number.isFinite(timestamp)) {
      throw new CheckpointCorruptError(threadId, "step or timestamp is not a valid number");
    }

    return {
      threadId,
      step,
      agentId:       (row["agent_id"] as string | null) ?? undefined,
      state:         safeParse<S>("state", row["state"]),
      nextNodes:     safeParse<string[]>("next_nodes", row["next_nodes"]),
      pendingSends:  safeParse<Array<{ node: string; args: Record<string, unknown> }>>("pending_sends", row["pending_sends"]),
      metadata:      row["metadata"] ? safeParse<Record<string, unknown>>("metadata", row["metadata"]) : undefined,
      pendingWrites: row["pending_writes"] ? safeParse<Array<{ nodeId: string; writes: Record<string, unknown> }>>("pending_writes", row["pending_writes"]) : undefined,
      timestamp,
    };
  }
}
