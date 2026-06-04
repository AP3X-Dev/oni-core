// ============================================================
// @oni.bot/core/platform - SQLite platform stores
// ============================================================
// Durable single-node stores for AgentSession and OutputArtifact
// records. Full records are preserved as JSON while hot query fields
// are indexed for status and artifact lookups.
// ============================================================

import type {
  AgentSession,
  AgentSessionStatus,
  AgentSessionStore,
  ArtifactStore,
  OutputArtifact,
} from "./types.js";

export interface SqlitePlatformStoreOptions {
  tablePrefix?: string;
}

type SqliteRunResult = {
  changes?: number;
};

type SqliteStatement = {
  run: (...params: unknown[]) => SqliteRunResult;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
};

export interface SqlitePlatformDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

type TableNames = {
  sessions: string;
  artifacts: string;
};

type SessionRow = {
  id: string;
  session_json: string;
};

type ArtifactRow = {
  id: string;
  session_id: string;
  artifact_json: string;
};

const DEFAULT_TABLE_PREFIX = "oni_platform";
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function resolveTables(options: SqlitePlatformStoreOptions = {}): TableNames {
  const prefix = options.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  if (!IDENTIFIER.test(prefix)) {
    throw new Error(`Invalid SQLite platform table prefix: ${prefix}`);
  }
  return {
    sessions: `${prefix}_sessions`,
    artifacts: `${prefix}_artifacts`,
  };
}

async function openDatabase(dbPath: string): Promise<SqlitePlatformDatabase> {
  let DB: new (path: string) => SqlitePlatformDatabase;
  try {
    const mod = await import("better-sqlite3" as string);
    DB = mod.default ?? mod;
  } catch {
    throw new Error("SQLite platform stores require: npm install better-sqlite3");
  }

  const db = new DB(dbPath);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function initializeSessionSchema(db: SqlitePlatformDatabase, table: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id           TEXT PRIMARY KEY,
      status       TEXT NOT NULL,
      priority     TEXT NOT NULL,
      task_id      TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      session_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${table}_status_created
      ON ${table} (status, created_at);
    CREATE INDEX IF NOT EXISTS idx_${table}_task
      ON ${table} (task_id);
  `);
}

function initializeArtifactSchema(db: SqlitePlatformDatabase, table: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      session_id    TEXT NOT NULL,
      id            TEXT NOT NULL,
      type          TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      artifact_json TEXT NOT NULL,
      PRIMARY KEY (session_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_${table}_session_created
      ON ${table} (session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_${table}_type
      ON ${table} (type);
  `);
}

function parseStoredJson<T>(kind: "session" | "artifact", id: string, raw: unknown): T {
  if (typeof raw !== "string") {
    throw new Error(`Corrupt SQLite platform ${kind} ${id}: stored JSON is not text.`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Corrupt SQLite platform ${kind} ${id}: failed to parse stored JSON.`);
  }
}

function sessionFromRow(row: unknown): AgentSession {
  const typed = row as SessionRow;
  return cloneRecord(parseStoredJson<AgentSession>("session", typed.id, typed.session_json));
}

function artifactFromRow(row: unknown): OutputArtifact {
  const typed = row as ArtifactRow;
  return cloneRecord(parseStoredJson<OutputArtifact>("artifact", typed.id, typed.artifact_json));
}

function changes(result: SqliteRunResult): number {
  return typeof result.changes === "number" ? result.changes : 0;
}

export class SqliteAgentSessionStore implements AgentSessionStore {
  private readonly sessionsTable: string;

  private constructor(
    private readonly db: SqlitePlatformDatabase,
    options: SqlitePlatformStoreOptions = {},
  ) {
    this.sessionsTable = resolveTables(options).sessions;
    initializeSessionSchema(this.db, this.sessionsTable);
  }

  static async create(dbPath: string, options: SqlitePlatformStoreOptions = {}): Promise<SqliteAgentSessionStore> {
    resolveTables(options);
    const db = await openDatabase(dbPath);
    try {
      return new SqliteAgentSessionStore(db, options);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  static fromDatabase(
    db: SqlitePlatformDatabase,
    options: SqlitePlatformStoreOptions = {},
  ): SqliteAgentSessionStore {
    return new SqliteAgentSessionStore(db, options);
  }

  create(session: AgentSession): void {
    const exists = this.get(session.id);
    if (exists) {
      throw new Error(`Session already exists: ${session.id}`);
    }

    this.db.prepare(`
      INSERT INTO ${this.sessionsTable}
        (id, status, priority, task_id, created_at, updated_at, session_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.status,
      session.priority,
      session.task.id ?? null,
      session.createdAt,
      session.updatedAt,
      JSON.stringify(session),
    );
  }

  save(session: AgentSession): void {
    const result = this.db.prepare(`
      UPDATE ${this.sessionsTable}
      SET status = ?,
          priority = ?,
          task_id = ?,
          created_at = ?,
          updated_at = ?,
          session_json = ?
      WHERE id = ?
    `).run(
      session.status,
      session.priority,
      session.task.id ?? null,
      session.createdAt,
      session.updatedAt,
      JSON.stringify(session),
      session.id,
    );
    if (changes(result) === 0) {
      throw new Error(`Session not found: ${session.id}`);
    }
  }

  get(sessionId: string): AgentSession | null {
    const row = this.db
      .prepare(`SELECT id, session_json FROM ${this.sessionsTable} WHERE id = ?`)
      .get(sessionId);
    return row ? sessionFromRow(row) : null;
  }

  list(filter?: { status?: AgentSessionStatus }): AgentSession[] {
    const rows = filter?.status
      ? this.db
          .prepare(`SELECT id, session_json FROM ${this.sessionsTable} WHERE status = ? ORDER BY created_at ASC, id ASC`)
          .all(filter.status)
      : this.db
          .prepare(`SELECT id, session_json FROM ${this.sessionsTable} ORDER BY created_at ASC, id ASC`)
          .all();
    return rows.map(sessionFromRow);
  }

  close(): void {
    this.db.close();
  }
}

export class SqliteArtifactStore implements ArtifactStore {
  private readonly artifactsTable: string;

  private constructor(
    private readonly db: SqlitePlatformDatabase,
    options: SqlitePlatformStoreOptions = {},
  ) {
    this.artifactsTable = resolveTables(options).artifacts;
    initializeArtifactSchema(this.db, this.artifactsTable);
  }

  static async create(dbPath: string, options: SqlitePlatformStoreOptions = {}): Promise<SqliteArtifactStore> {
    resolveTables(options);
    const db = await openDatabase(dbPath);
    try {
      return new SqliteArtifactStore(db, options);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  static fromDatabase(
    db: SqlitePlatformDatabase,
    options: SqlitePlatformStoreOptions = {},
  ): SqliteArtifactStore {
    return new SqliteArtifactStore(db, options);
  }

  put(artifact: OutputArtifact): OutputArtifact {
    this.db.prepare(`
      INSERT INTO ${this.artifactsTable}
        (session_id, id, type, created_at, artifact_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, id) DO UPDATE SET
        type = excluded.type,
        created_at = excluded.created_at,
        artifact_json = excluded.artifact_json
    `).run(
      artifact.sessionId,
      artifact.id,
      artifact.type,
      artifact.createdAt,
      JSON.stringify(artifact),
    );
    return cloneRecord(artifact);
  }

  list(sessionId: string): OutputArtifact[] {
    const rows = this.db
      .prepare(`SELECT id, session_id, artifact_json FROM ${this.artifactsTable} WHERE session_id = ? ORDER BY created_at ASC, id ASC`)
      .all(sessionId);
    return rows.map(artifactFromRow);
  }

  close(): void {
    this.db.close();
  }
}

export interface SqlitePlatformStores {
  sessionStore: SqliteAgentSessionStore;
  artifactStore: SqliteArtifactStore;
  close(): void;
}

export async function createSqlitePlatformStores(
  dbPath: string,
  options: SqlitePlatformStoreOptions = {},
): Promise<SqlitePlatformStores> {
  resolveTables(options);
  const db = await openDatabase(dbPath);
  return createSqlitePlatformStoresFromDatabase(db, options);
}

export function createSqlitePlatformStoresFromDatabase(
  db: SqlitePlatformDatabase,
  options: SqlitePlatformStoreOptions = {},
): SqlitePlatformStores {
  try {
    return {
      sessionStore: SqliteAgentSessionStore.fromDatabase(db, options),
      artifactStore: SqliteArtifactStore.fromDatabase(db, options),
      close() {
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
