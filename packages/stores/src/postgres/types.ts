// ============================================================
// @oni.bot/stores — Postgres backend types
// ============================================================

/** Minimal pg Pool/Client interface — satisfied by the `pg` package */
export interface PgClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end?(): Promise<void>;
}
