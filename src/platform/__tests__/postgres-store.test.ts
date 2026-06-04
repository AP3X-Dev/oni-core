import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundAgentPlatform,
  PostgresAgentSessionStore,
  PostgresArtifactStore,
  StaticAgentRouter,
  createPostgresPlatformStores,
  createPostgresPlatformStoresFromClient,
  type AgentSession,
  type OutputArtifact,
  type PostgresPlatformClient,
  type PostgresPlatformQueryResult,
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
    title: "Postgres report",
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
  session_json: unknown;
};

type ArtifactRow = {
  session_id: string;
  id: string;
  type: string;
  created_at: string;
  artifact_json: unknown;
};

class FakePostgresClient implements PostgresPlatformClient {
  readonly sessions = new Map<string, SessionRow>();
  readonly artifacts = new Map<string, ArtifactRow>();
  endCalled = false;

  constructor(_options?: { connectionString: string }) {}

  async query(sql: string, params: unknown[] = []): Promise<PostgresPlatformQueryResult> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("CREATE TABLE") || normalized.startsWith("CREATE INDEX")) {
      return { rows: [], rowCount: null };
    }

    if (normalized.startsWith("SELECT") && normalized.includes("_sessions") && normalized.includes("WHERE id = $1")) {
      const row = this.sessions.get(String(params[0]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith("INSERT INTO") && normalized.includes("_sessions")) {
      const parsed = JSON.parse(String(params[6])) as AgentSession;
      this.sessions.set(String(params[0]), {
        id: String(params[0]),
        status: String(params[1]),
        priority: String(params[2]),
        task_id: params[3] === null ? null : String(params[3]),
        created_at: String(params[4]),
        updated_at: String(params[5]),
        session_json: parsed,
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE") && normalized.includes("_sessions")) {
      const id = String(params[6]);
      if (!this.sessions.has(id)) return { rows: [], rowCount: 0 };
      this.sessions.set(id, {
        id,
        status: String(params[0]),
        priority: String(params[1]),
        task_id: params[2] === null ? null : String(params[2]),
        created_at: String(params[3]),
        updated_at: String(params[4]),
        session_json: JSON.parse(String(params[5])) as AgentSession,
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT") && normalized.includes("_sessions") && normalized.includes("WHERE status = $1")) {
      return {
        rows: [...this.sessions.values()]
          .filter((row) => row.status === params[0])
          .sort(compareCreated)
          .map((row) => structuredClone(row)),
      };
    }

    if (normalized.startsWith("SELECT") && normalized.includes("_sessions")) {
      return {
        rows: [...this.sessions.values()]
          .sort(compareCreated)
          .map((row) => structuredClone(row)),
      };
    }

    if (normalized.startsWith("INSERT INTO") && normalized.includes("_artifacts")) {
      const row: ArtifactRow = {
        session_id: String(params[0]),
        id: String(params[1]),
        type: String(params[2]),
        created_at: String(params[3]),
        artifact_json: JSON.parse(String(params[4])) as OutputArtifact,
      };
      this.artifacts.set(`${row.session_id}:${row.id}`, row);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT") && normalized.includes("_artifacts") && normalized.includes("WHERE session_id = $1")) {
      return {
        rows: [...this.artifacts.values()]
          .filter((row) => row.session_id === params[0])
          .sort(compareCreated)
          .map((row) => structuredClone(row)),
      };
    }

    throw new Error(`Unexpected fake Postgres query: ${normalized}`);
  }

  async end(): Promise<void> {
    this.endCalled = true;
  }

  corruptSessionJson(sessionId: string, raw: unknown): void {
    const row = this.sessions.get(sessionId);
    if (!row) throw new Error(`Missing fake session row: ${sessionId}`);
    this.sessions.set(sessionId, { ...row, session_json: raw });
  }

  corruptArtifactJson(sessionId: string, artifactId: string, raw: unknown): void {
    const key = `${sessionId}:${artifactId}`;
    const row = this.artifacts.get(key);
    if (!row) throw new Error(`Missing fake artifact row: ${key}`);
    this.artifacts.set(key, { ...row, artifact_json: raw });
  }
}

function compareCreated<T extends { created_at: string; id: string }>(a: T, b: T): number {
  const byTime = a.created_at.localeCompare(b.created_at);
  return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
}

describe("Postgres platform stores", () => {
  afterEach(() => {
    vi.doUnmock("pg");
  });

  it("persists sessions through an injected client and lists by status", async () => {
    const client = new FakePostgresClient();
    const store = PostgresAgentSessionStore.fromClient(client);
    await store.ensureSchema();
    const queued = session({
      id: "ses_queued",
      createdAt: "2026-05-23T00:00:01.000Z",
      updatedAt: "2026-05-23T00:00:01.000Z",
    });
    const completed = session({
      id: "ses_completed",
      status: "completed",
      priority: "critical",
      createdAt: "2026-05-23T00:00:02.000Z",
      updatedAt: "2026-05-23T00:00:02.000Z",
      result: "done",
    });

    await store.create(queued);
    await store.create(completed);
    await expect(store.create(queued)).rejects.toThrow("Session already exists");
    await expect(store.list()).resolves.toMatchObject([
      { id: "ses_queued" },
      { id: "ses_completed" },
    ]);
    await expect(store.list({ status: "completed" })).resolves.toMatchObject([
      { id: "ses_completed", priority: "critical" },
    ]);

    await store.save({
      ...queued,
      status: "running",
      updatedAt: "2026-05-23T00:00:03.000Z",
    });
    await expect(store.get("ses_queued")).resolves.toMatchObject({
      id: "ses_queued",
      status: "running",
    });
    await expect(store.save(session({ id: "missing" }))).rejects.toThrow("Session not found");
  });

  it("persists and upserts artifacts through an injected client", async () => {
    const client = new FakePostgresClient();
    const store = PostgresArtifactStore.fromClient(client);
    await store.ensureSchema();
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

    await expect(store.put(first)).resolves.toEqual(first);
    await store.put(second);
    await store.put({
      ...first,
      title: "Updated report",
      content: "Updated content",
    });

    await expect(store.list("ses_test")).resolves.toEqual([
      expect.objectContaining({ id: "art_a", title: "Updated report" }),
      expect.objectContaining({ id: "art_b", type: "test_summary" }),
    ]);
    await expect(store.list("other_session")).resolves.toEqual([]);
  });

  it("runs a platform task with shared Postgres session and artifact stores", async () => {
    const client = new FakePostgresClient();
    const stores = await createPostgresPlatformStoresFromClient(client);
    const platform = new BackgroundAgentPlatform({
      router: new StaticAgentRouter({ agentId: "postgres-worker", runtime: "test" }),
      runner: {
        async run() {
          return {
            summary: "Postgres platform run complete.",
            artifacts: [{
              type: "report",
              title: "Postgres platform report",
              content: "Stored in Postgres.",
            }],
          };
        },
      },
      sessionStore: stores.sessionStore,
      artifactStore: stores.artifactStore,
    });

    const completed = await platform.runTask({ task: task({ id: undefined }) });
    expect(completed.status).toBe("completed");
    await expect(stores.sessionStore.get(completed.id)).resolves.toMatchObject({
      id: completed.id,
      status: "completed",
      result: "Postgres platform run complete.",
    });
    await expect(stores.artifactStore.list(completed.id)).resolves.toEqual([
      expect.objectContaining({ title: "Postgres platform report" }),
    ]);
    await stores.close();
    expect(client.endCalled).toBe(true);
  });

  it("reports corrupt stored JSON without leaking raw payloads", async () => {
    const client = new FakePostgresClient();
    const sessions = PostgresAgentSessionStore.fromClient(client);
    const artifacts = PostgresArtifactStore.fromClient(client);
    await sessions.create(session());
    await artifacts.put(artifact());
    client.corruptSessionJson("ses_test", "{not-json");
    client.corruptArtifactJson("ses_test", "art_test", 42);

    await expect(sessions.get("ses_test")).rejects.toThrow("failed to parse stored JSON");
    await expect(artifacts.list("ses_test")).rejects.toThrow("stored JSON is not an object");
  });

  it("opens stores through the optional pg peer when available", async () => {
    vi.doMock("pg", () => ({ Pool: FakePostgresClient }));

    const sessions = await PostgresAgentSessionStore.create("postgres://example/test");
    await sessions.create(session({ id: "ses_static" }));
    await expect(sessions.get("ses_static")).resolves.toMatchObject({ id: "ses_static" });
    await sessions.close();

    const artifacts = await PostgresArtifactStore.create("postgres://example/test");
    await artifacts.put(artifact({ id: "art_static", sessionId: "ses_static" }));
    await expect(artifacts.list("ses_static")).resolves.toEqual([
      expect.objectContaining({ id: "art_static" }),
    ]);
    await artifacts.close();

    const stores = await createPostgresPlatformStores("postgres://example/test", {
      tablePrefix: "custom_platform",
    });
    await stores.sessionStore.create(session({ id: "ses_factory" }));
    await stores.artifactStore.put(artifact({ id: "art_factory", sessionId: "ses_factory" }));
    await expect(stores.sessionStore.get("ses_factory")).resolves.toMatchObject({ id: "ses_factory" });
    await expect(stores.artifactStore.list("ses_factory")).resolves.toHaveLength(1);
    await stores.close();
  });

  it("rejects unsafe table prefixes", async () => {
    expect(() => PostgresAgentSessionStore.fromClient(
      new FakePostgresClient(),
      { tablePrefix: "bad-prefix" },
    )).toThrow("Invalid Postgres platform table prefix");
    await expect(
      createPostgresPlatformStores("postgres://example/test", { tablePrefix: "bad-prefix" }),
    ).rejects.toThrow("Invalid Postgres platform table prefix");
  });
});
