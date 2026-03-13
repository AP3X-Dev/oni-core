// ============================================================
// @oni.bot/core — PostgreSQL Checkpointer
// ============================================================
// Production-grade checkpointer using PostgreSQL.
// Requires `pg` as an optional peer dependency.
// ============================================================

import type { ONICheckpoint, ONICheckpointer, CheckpointListOptions } from "../types.js";

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export class PostgresCheckpointer<S> implements ONICheckpointer<S> {
  private constructor(private readonly pool: PgPool) {}

  static async create<S>(connectionString: string): Promise<PostgresCheckpointer<S>> {
    // @ts-ignore — pg is an optional peer dependency
    const pg = await import("pg");
    const Pool = pg.Pool ?? (pg.default as any)?.Pool ?? pg;
    const pool = new Pool({ connectionString }) as PgPool;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS oni_checkpoints (
        thread_id      TEXT    NOT NULL,
        step           INTEGER NOT NULL,
        agent_id       TEXT,
        state          JSONB   NOT NULL,
        next_nodes     JSONB   NOT NULL,
        pending_sends  JSONB   NOT NULL DEFAULT '[]',
        metadata       JSONB,
        pending_writes JSONB,
        timestamp      BIGINT  NOT NULL,
        PRIMARY KEY (thread_id, step)
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_oni_cp_thread ON oni_checkpoints (thread_id)`
    );

    return new PostgresCheckpointer<S>(pool);
  }

  async get(threadId: string): Promise<ONICheckpoint<S> | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM oni_checkpoints WHERE thread_id=$1 ORDER BY step DESC LIMIT 1",
      [threadId]
    );
    return rows.length > 0 ? this.deserialize(rows[0]) : null;
  }

  async put(cp: ONICheckpoint<S>): Promise<void> {
    await this.pool.query(
      `INSERT INTO oni_checkpoints
        (thread_id, step, agent_id, state, next_nodes, pending_sends, metadata, pending_writes, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (thread_id, step)
       DO UPDATE SET state=$4, next_nodes=$5, pending_sends=$6, metadata=$7, pending_writes=$8, timestamp=$9`,
      [
        cp.threadId,
        cp.step,
        cp.agentId ?? null,
        JSON.stringify(cp.state),
        JSON.stringify(cp.nextNodes),
        JSON.stringify(cp.pendingSends ?? []),
        cp.metadata ? JSON.stringify(cp.metadata) : null,
        cp.pendingWrites ? JSON.stringify(cp.pendingWrites) : null,
        cp.timestamp,
      ]
    );
  }

  async list(threadId: string, opts?: CheckpointListOptions): Promise<ONICheckpoint<S>[]> {
    let sql = "SELECT * FROM oni_checkpoints WHERE thread_id=$1";
    const params: unknown[] = [threadId];
    let paramIdx = 2;

    if (opts?.before !== undefined) {
      sql += ` AND step < $${paramIdx++}`;
      params.push(opts.before);
    }

    sql += " ORDER BY step ASC";

    if (opts?.limit !== undefined) {
      sql += ` LIMIT $${paramIdx++}`;
      params.push(opts.limit);
    }

    const { rows } = await this.pool.query(sql, params);
    let items = rows.map(r => this.deserialize(r));

    if (opts?.filter) {
      items = items.filter(c => {
        if (!c.metadata) return false;
        return Object.entries(opts.filter!).every(([k, v]) => c.metadata![k] === v);
      });
    }

    return items;
  }

  async delete(threadId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM oni_checkpoints WHERE thread_id=$1",
      [threadId]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private deserialize(row: Record<string, unknown>): ONICheckpoint<S> {
    const parse = (val: unknown) =>
      typeof val === "string" ? JSON.parse(val) : val;

    return {
      threadId:      row.thread_id as string,
      step:          row.step as number,
      agentId:       (row.agent_id as string | null) ?? undefined,
      state:         parse(row.state) as S,
      nextNodes:     parse(row.next_nodes) as string[],
      pendingSends:  parse(row.pending_sends) as Array<{ node: string; args: Record<string, unknown> }>,
      metadata:      row.metadata ? parse(row.metadata) as Record<string, unknown> : undefined,
      pendingWrites: row.pending_writes ? parse(row.pending_writes) as Array<{ nodeId: string; writes: Record<string, unknown> }> : undefined,
      timestamp:     Number(row.timestamp),
    };
  }
}
