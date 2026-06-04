// ============================================================
// @oni.bot/core/platform - Postgres platform stores
// ============================================================
// Durable multi-node stores for AgentSession and OutputArtifact
// records. Full records are stored as JSONB while hot query fields
// are indexed for session and artifact lookups.
// ============================================================

import type {
  AgentSession,
  AgentSessionStatus,
  AgentSessionStore,
  ArtifactStore,
  OutputArtifact,
} from "./types.js";

export interface PostgresPlatformStoreOptions {
  tablePrefix?: string;
}

export interface PostgresPlatformQueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

export interface PostgresPlatformClient {
  query(sql: string, params?: unknown[]): Promise<PostgresPlatformQueryResult>;
  end?(): Promise<void>;
}

type PgPoolConstructor = new (options: { connectionString: string }) => PostgresPlatformClient;

type TableNames = {
  sessions: string;
  artifacts: string;
};

const DEFAULT_TABLE_PREFIX = "oni_platform";
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConstructor(value: unknown): value is PgPoolConstructor {
  return typeof value === "function";
}

function resolvePgPool(pg: unknown): PgPoolConstructor {
  if (isRecord(pg) && isConstructor(pg.Pool)) return pg.Pool;
  const defaultExport = isRecord(pg) ? pg.default : undefined;
  if (isRecord(defaultExport) && isConstructor(defaultExport.Pool)) return defaultExport.Pool;
  if (isConstructor(defaultExport)) return defaultExport;
  if (isConstructor(pg)) return pg;
  throw new Error("Could not find Pool in pg module.");
}

async function openClient(connectionString: string): Promise<PostgresPlatformClient> {
  try {
    const pg = await import("pg" as string);
    const Pool = resolvePgPool(pg);
    return new Pool({ connectionString });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      throw new Error("Postgres platform stores require: npm install pg");
    }
    throw error;
  }
}

function resolveTables(options: PostgresPlatformStoreOptions = {}): TableNames {
  const prefix = options.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  if (!IDENTIFIER.test(prefix)) {
    throw new Error(`Invalid Postgres platform table prefix: ${prefix}`);
  }
  return {
    sessions: `${prefix}_sessions`,
    artifacts: `${prefix}_artifacts`,
  };
}

async function initializeSessionSchema(client: PostgresPlatformClient, table: string): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id           TEXT PRIMARY KEY,
      status       TEXT NOT NULL,
      priority     TEXT NOT NULL,
      task_id      TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      session_json JSONB NOT NULL
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_${table}_status_created
      ON ${table} (status, created_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_${table}_task
      ON ${table} (task_id)
  `);
}

async function initializeArtifactSchema(client: PostgresPlatformClient, table: string): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      session_id    TEXT NOT NULL,
      id            TEXT NOT NULL,
      type          TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      artifact_json JSONB NOT NULL,
      PRIMARY KEY (session_id, id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_${table}_session_created
      ON ${table} (session_id, created_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_${table}_type
      ON ${table} (type)
  `);
}

function parseStoredJson<T>(kind: "session" | "artifact", id: string, raw: unknown): T {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Corrupt Postgres platform ${kind} ${id}: failed to parse stored JSON.`);
    }
  }
  if (isRecord(raw)) {
    return cloneRecord(raw) as T;
  }
  throw new Error(`Corrupt Postgres platform ${kind} ${id}: stored JSON is not an object.`);
}

function sessionFromRow(row: Record<string, unknown>): AgentSession {
  return cloneRecord(parseStoredJson<AgentSession>("session", String(row.id), row.session_json));
}

function artifactFromRow(row: Record<string, unknown>): OutputArtifact {
  return cloneRecord(parseStoredJson<OutputArtifact>("artifact", String(row.id), row.artifact_json));
}

function changedRows(result: PostgresPlatformQueryResult): number {
  return typeof result.rowCount === "number" ? result.rowCount : result.rows.length;
}

export class PostgresAgentSessionStore implements AgentSessionStore {
  private readonly sessionsTable: string;

  private constructor(
    private readonly client: PostgresPlatformClient,
    options: PostgresPlatformStoreOptions = {},
  ) {
    this.sessionsTable = resolveTables(options).sessions;
  }

  static async create(
    connectionString: string,
    options: PostgresPlatformStoreOptions = {},
  ): Promise<PostgresAgentSessionStore> {
    resolveTables(options);
    const client = await openClient(connectionString);
    try {
      const store = PostgresAgentSessionStore.fromClient(client, options);
      await store.ensureSchema();
      return store;
    } catch (error) {
      await client.end?.().catch(() => {});
      throw error;
    }
  }

  static fromClient(
    client: PostgresPlatformClient,
    options: PostgresPlatformStoreOptions = {},
  ): PostgresAgentSessionStore {
    return new PostgresAgentSessionStore(client, options);
  }

  async ensureSchema(): Promise<void> {
    await initializeSessionSchema(this.client, this.sessionsTable);
  }

  async create(session: AgentSession): Promise<void> {
    const exists = await this.get(session.id);
    if (exists) {
      throw new Error(`Session already exists: ${session.id}`);
    }

    await this.client.query(`
      INSERT INTO ${this.sessionsTable}
        (id, status, priority, task_id, created_at, updated_at, session_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `, [
      session.id,
      session.status,
      session.priority,
      session.task.id ?? null,
      session.createdAt,
      session.updatedAt,
      JSON.stringify(session),
    ]);
  }

  async save(session: AgentSession): Promise<void> {
    const result = await this.client.query(`
      UPDATE ${this.sessionsTable}
      SET status = $1,
          priority = $2,
          task_id = $3,
          created_at = $4,
          updated_at = $5,
          session_json = $6::jsonb
      WHERE id = $7
    `, [
      session.status,
      session.priority,
      session.task.id ?? null,
      session.createdAt,
      session.updatedAt,
      JSON.stringify(session),
      session.id,
    ]);
    if (changedRows(result) === 0) {
      throw new Error(`Session not found: ${session.id}`);
    }
  }

  async get(sessionId: string): Promise<AgentSession | null> {
    const result = await this.client.query(
      `SELECT id, session_json FROM ${this.sessionsTable} WHERE id = $1`,
      [sessionId],
    );
    return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
  }

  async list(filter?: { status?: AgentSessionStatus }): Promise<AgentSession[]> {
    const result = filter?.status
      ? await this.client.query(
          `SELECT id, session_json FROM ${this.sessionsTable} WHERE status = $1 ORDER BY created_at ASC, id ASC`,
          [filter.status],
        )
      : await this.client.query(
          `SELECT id, session_json FROM ${this.sessionsTable} ORDER BY created_at ASC, id ASC`,
        );
    return result.rows.map(sessionFromRow);
  }

  async close(): Promise<void> {
    await this.client.end?.();
  }
}

export class PostgresArtifactStore implements ArtifactStore {
  private readonly artifactsTable: string;

  private constructor(
    private readonly client: PostgresPlatformClient,
    options: PostgresPlatformStoreOptions = {},
  ) {
    this.artifactsTable = resolveTables(options).artifacts;
  }

  static async create(
    connectionString: string,
    options: PostgresPlatformStoreOptions = {},
  ): Promise<PostgresArtifactStore> {
    resolveTables(options);
    const client = await openClient(connectionString);
    try {
      const store = PostgresArtifactStore.fromClient(client, options);
      await store.ensureSchema();
      return store;
    } catch (error) {
      await client.end?.().catch(() => {});
      throw error;
    }
  }

  static fromClient(
    client: PostgresPlatformClient,
    options: PostgresPlatformStoreOptions = {},
  ): PostgresArtifactStore {
    return new PostgresArtifactStore(client, options);
  }

  async ensureSchema(): Promise<void> {
    await initializeArtifactSchema(this.client, this.artifactsTable);
  }

  async put(artifact: OutputArtifact): Promise<OutputArtifact> {
    await this.client.query(`
      INSERT INTO ${this.artifactsTable}
        (session_id, id, type, created_at, artifact_json)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT(session_id, id) DO UPDATE SET
        type = EXCLUDED.type,
        created_at = EXCLUDED.created_at,
        artifact_json = EXCLUDED.artifact_json
    `, [
      artifact.sessionId,
      artifact.id,
      artifact.type,
      artifact.createdAt,
      JSON.stringify(artifact),
    ]);
    return cloneRecord(artifact);
  }

  async list(sessionId: string): Promise<OutputArtifact[]> {
    const result = await this.client.query(
      `SELECT id, session_id, artifact_json FROM ${this.artifactsTable} WHERE session_id = $1 ORDER BY created_at ASC, id ASC`,
      [sessionId],
    );
    return result.rows.map(artifactFromRow);
  }

  async close(): Promise<void> {
    await this.client.end?.();
  }
}

export interface PostgresPlatformStores {
  sessionStore: PostgresAgentSessionStore;
  artifactStore: PostgresArtifactStore;
  close(): Promise<void>;
}

export async function createPostgresPlatformStores(
  connectionString: string,
  options: PostgresPlatformStoreOptions = {},
): Promise<PostgresPlatformStores> {
  resolveTables(options);
  const client = await openClient(connectionString);
  try {
    return await createPostgresPlatformStoresFromClient(client, options);
  } catch (error) {
    await client.end?.().catch(() => {});
    throw error;
  }
}

export async function createPostgresPlatformStoresFromClient(
  client: PostgresPlatformClient,
  options: PostgresPlatformStoreOptions = {},
): Promise<PostgresPlatformStores> {
  const sessionStore = PostgresAgentSessionStore.fromClient(client, options);
  const artifactStore = PostgresArtifactStore.fromClient(client, options);
  try {
    await sessionStore.ensureSchema();
    await artifactStore.ensureSchema();
    return {
      sessionStore,
      artifactStore,
      async close() {
        await client.end?.();
      },
    };
  } catch (error) {
    await client.end?.().catch(() => {});
    throw error;
  }
}
