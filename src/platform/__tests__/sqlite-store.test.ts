import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundAgentPlatform,
  SqliteAgentSessionStore,
  SqliteArtifactStore,
  StaticAgentRouter,
  createSqlitePlatformStores,
  createSqlitePlatformStoresFromDatabase,
  type AgentSession,
  type OutputArtifact,
  type SqlitePlatformDatabase,
  type TaskSpec,
} from "../index.js";

function task(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task_test",
    title: "Persist platform session",
    goal: "Store a platform session durably.",
    successCriteria: ["The session can be restored."],
    ...overrides,
  };
}

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "ses_test",
    task: task(),
    trigger: {
      id: "trg_test",
      kind: "manual",
      source: "test",
      firedAt: "2026-05-23T00:00:00.000Z",
    },
    status: "queued",
    artifacts: [],
    audit: [],
    priority: "normal",
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

function artifact(overrides: Partial<OutputArtifact> = {}): OutputArtifact {
  return {
    id: "art_test",
    sessionId: "ses_test",
    type: "report",
    title: "SQLite report",
    content: "Persisted report",
    createdAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

type SessionRow = {
  id: string;
  status: string;
  priority: string;
  task_id: string | null;
  created_at: string;
  updated_at: string;
  session_json: string;
};

type ArtifactRow = {
  session_id: string;
  id: string;
  type: string;
  created_at: string;
  artifact_json: string;
};

class FakeSqliteDatabase implements SqlitePlatformDatabase {
  private readonly sessions = new Map<string, SessionRow>();
  private readonly artifacts = new Map<string, ArtifactRow>();

  constructor(_path?: string) {}

  exec(_sql: string): void {}

  close(): void {}

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    return {
      run: (...params: unknown[]) => this.run(normalized, params),
      get: (...params: unknown[]) => this.get(normalized, params),
      all: (...params: unknown[]) => this.all(normalized, params),
    };
  }

  private run(sql: string, params: unknown[]): { changes: number } {
    if (sql.startsWith("INSERT INTO") && sql.includes("_sessions")) {
      const row: SessionRow = {
        id: String(params[0]),
        status: String(params[1]),
        priority: String(params[2]),
        task_id: params[3] === null ? null : String(params[3]),
        created_at: String(params[4]),
        updated_at: String(params[5]),
        session_json: String(params[6]),
      };
      this.sessions.set(row.id, row);
      return { changes: 1 };
    }

    if (sql.startsWith("UPDATE") && sql.includes("_sessions")) {
      const id = String(params[6]);
      if (!this.sessions.has(id)) return { changes: 0 };
      this.sessions.set(id, {
        id,
        status: String(params[0]),
        priority: String(params[1]),
        task_id: params[2] === null ? null : String(params[2]),
        created_at: String(params[3]),
        updated_at: String(params[4]),
        session_json: String(params[5]),
      });
      return { changes: 1 };
    }

    if (sql.startsWith("INSERT INTO") && sql.includes("_artifacts")) {
      const row: ArtifactRow = {
        session_id: String(params[0]),
        id: String(params[1]),
        type: String(params[2]),
        created_at: String(params[3]),
        artifact_json: String(params[4]),
      };
      this.artifacts.set(`${row.session_id}:${row.id}`, row);
      return { changes: 1 };
    }

    throw new Error(`Unexpected fake SQLite run: ${sql}`);
  }

  private get(sql: string, params: unknown[]): unknown {
    if (sql.startsWith("SELECT") && sql.includes("_sessions") && sql.includes("WHERE id = ?")) {
      return this.clone(this.sessions.get(String(params[0])));
    }
    throw new Error(`Unexpected fake SQLite get: ${sql}`);
  }

  private all(sql: string, params: unknown[]): unknown[] {
    if (sql.startsWith("SELECT") && sql.includes("_sessions") && sql.includes("WHERE status = ?")) {
      return [...this.sessions.values()]
        .filter((row) => row.status === params[0])
        .sort(compareCreated)
        .map((row) => this.clone(row));
    }

    if (sql.startsWith("SELECT") && sql.includes("_sessions")) {
      return [...this.sessions.values()]
        .sort(compareCreated)
        .map((row) => this.clone(row));
    }

    if (sql.startsWith("SELECT") && sql.includes("_artifacts") && sql.includes("WHERE session_id = ?")) {
      return [...this.artifacts.values()]
        .filter((row) => row.session_id === params[0])
        .sort(compareCreated)
        .map((row) => this.clone(row));
    }

    throw new Error(`Unexpected fake SQLite all: ${sql}`);
  }

  private clone<T>(value: T): T {
    return value ? structuredClone(value) : value;
  }

  corruptSessionJson(sessionId: string, json: string): void {
    const row = this.sessions.get(sessionId);
    if (!row) throw new Error(`Missing fake session row: ${sessionId}`);
    this.sessions.set(sessionId, { ...row, session_json: json });
  }

  corruptArtifactJson(sessionId: string, artifactId: string, json: string): void {
    const key = `${sessionId}:${artifactId}`;
    const row = this.artifacts.get(key);
    if (!row) throw new Error(`Missing fake artifact row: ${key}`);
    this.artifacts.set(key, { ...row, artifact_json: json });
  }
}

function compareCreated<T extends { created_at: string; id: string }>(a: T, b: T): number {
  const byTime = a.created_at.localeCompare(b.created_at);
  return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
}

describe("SQLite platform stores", () => {
  afterEach(() => {
    vi.doUnmock("better-sqlite3");
  });

  it("persists sessions across store instances and lists by status", async () => {
    const db = new FakeSqliteDatabase();
    const store = SqliteAgentSessionStore.fromDatabase(db);
    const queued = session({
      id: "ses_queued",
      createdAt: "2026-05-23T00:00:01.000Z",
      updatedAt: "2026-05-23T00:00:01.000Z",
    });
    const completed = session({
      id: "ses_completed",
      status: "completed",
      priority: "high",
      createdAt: "2026-05-23T00:00:02.000Z",
      updatedAt: "2026-05-23T00:00:02.000Z",
      result: "done",
    });

    store.create(queued);
    store.create(completed);
    expect(() => store.create(queued)).toThrow("Session already exists");
    expect(store.list().map((item) => item.id)).toEqual(["ses_queued", "ses_completed"]);
    expect(store.list({ status: "completed" }).map((item) => item.id)).toEqual(["ses_completed"]);

    const updated = {
      ...queued,
      status: "running" as const,
      updatedAt: "2026-05-23T00:00:03.000Z",
    };
    store.save(updated);
    expect(store.get("ses_queued")).toMatchObject({ id: "ses_queued", status: "running" });

    const reopened = SqliteAgentSessionStore.fromDatabase(db);
    expect(reopened.get("ses_completed")).toMatchObject({
      id: "ses_completed",
      status: "completed",
      priority: "high",
      result: "done",
    });
    expect(() => reopened.save(session({ id: "missing" }))).toThrow("Session not found");
  });

  it("persists and upserts artifacts across store instances", async () => {
    const db = new FakeSqliteDatabase();
    const store = SqliteArtifactStore.fromDatabase(db);
    const first = artifact({
      id: "art_a",
      createdAt: "2026-05-23T00:00:01.000Z",
    });
    const second = artifact({
      id: "art_b",
      type: "test_summary",
      title: "Test summary",
      createdAt: "2026-05-23T00:00:02.000Z",
    });

    expect(store.put(first)).toEqual(first);
    store.put(second);
    store.put({
      ...first,
      title: "Updated report",
      content: "Updated content",
    });
    expect(store.list("ses_test")).toEqual([
      expect.objectContaining({ id: "art_a", title: "Updated report" }),
      expect.objectContaining({ id: "art_b", type: "test_summary" }),
    ]);

    const reopened = SqliteArtifactStore.fromDatabase(db);
    expect(reopened.list("ses_test")).toHaveLength(2);
    expect(reopened.list("other_session")).toEqual([]);
  });

  it("reports corrupt stored JSON without leaking raw payloads", () => {
    const db = new FakeSqliteDatabase();
    const sessions = SqliteAgentSessionStore.fromDatabase(db);
    const artifacts = SqliteArtifactStore.fromDatabase(db);

    sessions.create(session());
    artifacts.put(artifact());
    db.corruptSessionJson("ses_test", "{not-json");
    db.corruptArtifactJson("ses_test", "art_test", "{not-json");

    expect(() => sessions.get("ses_test")).toThrow("failed to parse stored JSON");
    expect(() => artifacts.list("ses_test")).toThrow("failed to parse stored JSON");
  });

  it("runs a platform task with shared SQLite session and artifact stores", async () => {
    const db = new FakeSqliteDatabase();
    const stores = createSqlitePlatformStoresFromDatabase(db);
    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "sqlite-worker", runtime: "test" }),
      runner: {
        async run() {
          return {
            summary: "SQLite platform run complete.",
            artifacts: [{
              type: "report",
              title: "SQLite platform report",
              content: "Stored in SQLite.",
            }],
          };
        },
      },
      sessionStore: stores.sessionStore,
      artifactStore: stores.artifactStore,
    });

    const completed = await platform.runTask({ task: task({ id: undefined }) });
    expect(completed.status).toBe("completed");
    expect(stores.artifactStore.list(completed.id)).toEqual([
      expect.objectContaining({
        type: "report",
        title: "SQLite platform report",
      }),
    ]);

    const sessions = SqliteAgentSessionStore.fromDatabase(db);
    const artifacts = SqliteArtifactStore.fromDatabase(db);
    expect(sessions.get(completed.id)).toMatchObject({
      id: completed.id,
      status: "completed",
      result: "SQLite platform run complete.",
    });
    expect(artifacts.list(completed.id)).toHaveLength(1);
  });

  it("opens stores through the optional better-sqlite3 peer when available", async () => {
    vi.doMock("better-sqlite3", () => ({ default: FakeSqliteDatabase }));

    const sessions = await SqliteAgentSessionStore.create("platform.sqlite");
    sessions.create(session({ id: "ses_static" }));
    expect(sessions.get("ses_static")).toMatchObject({ id: "ses_static" });
    sessions.close();

    const artifacts = await SqliteArtifactStore.create("platform.sqlite");
    artifacts.put(artifact({ id: "art_static", sessionId: "ses_static" }));
    expect(artifacts.list("ses_static")).toEqual([
      expect.objectContaining({ id: "art_static" }),
    ]);
    artifacts.close();

    const stores = await createSqlitePlatformStores("platform.sqlite", {
      tablePrefix: "custom_platform",
    });
    stores.sessionStore.create(session({ id: "ses_factory" }));
    stores.artifactStore.put(artifact({ id: "art_factory", sessionId: "ses_factory" }));
    expect(stores.sessionStore.get("ses_factory")).toMatchObject({ id: "ses_factory" });
    expect(stores.artifactStore.list("ses_factory")).toHaveLength(1);
    stores.close();
  });

  it("rejects unsafe table prefixes", async () => {
    expect(() => SqliteAgentSessionStore.fromDatabase(
      new FakeSqliteDatabase(),
      { tablePrefix: "bad-prefix" },
    )).toThrow("Invalid SQLite platform table prefix");
    await expect(
      createSqlitePlatformStores("platform.sqlite", { tablePrefix: "bad-prefix" }),
    ).rejects.toThrow("Invalid SQLite platform table prefix");
  });
});
