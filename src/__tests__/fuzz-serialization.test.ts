// ============================================================
// Property-based (fuzz) tests for JSON round-trip safety of the
// platform artifact/audit/session records and the store-level
// (de)serialization helpers.
//
// The platform stores serialize full records with JSON.stringify and
// rehydrate them with JSON.parse (see src/platform/sqlite-store.ts and
// src/platform/filesystem.ts). The SQLite parse helper wraps JSON.parse
// in a try/catch and rethrows a sanitized "failed to parse stored JSON"
// error instead of leaking the raw SyntaxError. These tests assert that
// contract holds for arbitrary inputs, with bounded numRuns to stay
// deterministic and fast.
// ============================================================

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SqliteAgentSessionStore,
  SqliteArtifactStore,
  type AgentSession,
  type OutputArtifact,
  type OutputArtifactType,
  type PlatformAuditEvent,
  type PlatformAuditEventType,
  type SqlitePlatformDatabase,
} from "../platform/index.js";

// ------------------------------------------------------------
// Fake SQLite database (deterministic, in-memory). Mirrors the
// FakeSqliteDatabase used in src/platform/__tests__/sqlite-store.ts so
// that records flow through the real store JSON.stringify/JSON.parse
// code path without touching disk or the native better-sqlite3 binding.
// ------------------------------------------------------------

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
    if (sql.startsWith("SELECT") && sql.includes("_artifacts") && sql.includes("WHERE session_id = ?")) {
      return [...this.artifacts.values()]
        .filter((row) => row.session_id === params[0])
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
}

// ------------------------------------------------------------
// Arbitraries
// ------------------------------------------------------------

// A JSON-safe metadata value space. fc.jsonValue never produces
// undefined / NaN / -0, so JSON.stringify -> JSON.parse is lossless.
const jsonSafe = fc.jsonValue();

// A record<string, unknown> whose properties are all JSON-safe. Used
// for the optional metadata / data / payload bags on platform records.
// noNullPrototype:true keeps generated objects on Object.prototype (so
// toStrictEqual is well-defined) and avoids the special-cased "__proto__"
// own-key, which does not survive a JSON round-trip identically.
const jsonObject = fc.dictionary(fc.string(), jsonSafe, { noNullPrototype: true });

// Normalize an arbitrary-generated value so it round-trips by strict
// equality. Two concerns:
//   1. JSON.stringify silently omits `undefined`-valued properties, so an
//      optional field set to `undefined` would not survive. We drop those
//      keys to model a truly-absent field.
//   2. fast-check's fc.record / fc.dictionary can yield null-prototype
//      objects, but JSON.parse always rehydrates onto Object.prototype.
//      We rebuild plain objects on Object.prototype so toStrictEqual
//      (which compares prototypes) is well-defined. This canonicalizes
//      prototypes only; it does NOT pre-serialize, so the round-trip
//      assertions still exercise the real JSON.stringify/parse path.
function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => compact(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (inner !== undefined) out[key] = compact(inner);
    }
    return out as T;
  }
  return value;
}

// ISO-8601 timestamp string. noInvalidDate avoids the `Invalid Date`
// case that would throw from `.toISOString()`. The resulting value is a
// plain string, which always round-trips through JSON losslessly.
const arbIsoTimestamp = fc.date({ noInvalidDate: true }).map((d) => d.toISOString());

const ARTIFACT_TYPES: OutputArtifactType[] = [
  "pull_request",
  "patch",
  "review_comment",
  "report",
  "test_summary",
  "issue_triage",
  "release_note",
  "failed_run_diagnosis",
  "custom",
];

const AUDIT_TYPES: PlatformAuditEventType[] = [
  "session.created",
  "session.completed",
  "session.failed",
  "artifact.created",
  "review.requested",
  "policy.denied",
  "budget.warning",
];

// Build an OutputArtifact. Optional fields are either present with a
// JSON-safe value or omitted entirely (never set to `undefined`), which
// keeps JSON.stringify/JSON.parse a true structural identity.
const arbArtifact: fc.Arbitrary<OutputArtifact> = fc
  .record(
    {
      id: fc.string({ minLength: 1 }),
      sessionId: fc.string({ minLength: 1 }),
      type: fc.constantFrom(...ARTIFACT_TYPES),
      title: fc.string(),
      createdAt: arbIsoTimestamp,
      content: fc.option(fc.string(), { nil: undefined }),
      uri: fc.option(fc.webUrl(), { nil: undefined }),
      metadata: fc.option(jsonObject, { nil: undefined }),
    },
    { requiredKeys: ["id", "sessionId", "type", "title", "createdAt"] },
  )
  .map(compact);

// Build a PlatformAuditEvent with optional fields omitted when absent.
const arbAuditEvent: fc.Arbitrary<PlatformAuditEvent> = fc
  .record(
    {
      id: fc.string({ minLength: 1 }),
      type: fc.constantFrom(...AUDIT_TYPES),
      timestamp: arbIsoTimestamp,
      sessionId: fc.option(fc.string(), { nil: undefined }),
      actor: fc.option(fc.string(), { nil: undefined }),
      data: fc.option(jsonObject, { nil: undefined }),
    },
    { requiredKeys: ["id", "type", "timestamp"] },
  )
  .map(compact);

// Build a minimally-valid AgentSession carrying arbitrary artifacts and
// audit events plus an optional metadata bag.
const arbSession: fc.Arbitrary<AgentSession> = fc.record(
  {
    id: fc.string({ minLength: 1 }),
    task: fc.record({
      id: fc.string({ minLength: 1 }),
      title: fc.string({ minLength: 1 }),
      goal: fc.string({ minLength: 1 }),
      successCriteria: fc.array(fc.string(), { minLength: 1, maxLength: 4 }),
    }),
    trigger: fc.record({
      id: fc.string({ minLength: 1 }),
      kind: fc.constant("manual" as const),
      source: fc.string({ minLength: 1 }),
      firedAt: arbIsoTimestamp,
    }),
    status: fc.constantFrom(
      "queued" as const,
      "running" as const,
      "completed" as const,
      "failed" as const,
    ),
    artifacts: fc.array(arbArtifact, { maxLength: 3 }),
    audit: fc.array(arbAuditEvent, { maxLength: 4 }),
    priority: fc.constantFrom(
      "low" as const,
      "normal" as const,
      "high" as const,
      "critical" as const,
    ),
    createdAt: arbIsoTimestamp,
    updatedAt: arbIsoTimestamp,
    metadata: fc.option(jsonObject, { nil: undefined }),
  },
  {
    requiredKeys: [
      "id",
      "task",
      "trigger",
      "status",
      "artifacts",
      "audit",
      "priority",
      "createdAt",
      "updatedAt",
    ],
  },
).map(compact) as fc.Arbitrary<AgentSession>;

// Deterministic + fast: small, fixed run budget and a fixed seed.
const RUN_OPTS = { numRuns: 120, seed: 0x0f1a2b3c } as const;

// The same safe-parse contract the SQLite store applies: JSON.parse
// wrapped in try/catch, returning a sentinel instead of throwing.
function safeParse<T>(raw: string): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------
// Property 1 - structural round-trip
// ------------------------------------------------------------

describe("fuzz: JSON structural round-trip", () => {
  it("JSON.parse(JSON.stringify(x)) deep-equals x for arbitrary JSON values", () => {
    fc.assert(
      fc.property(jsonSafe, (value) => {
        const roundTripped = JSON.parse(JSON.stringify(value));
        expect(roundTripped).toStrictEqual(value);
      }),
      RUN_OPTS,
    );
  });

  it("round-trips arbitrary JSON-safe metadata objects without loss", () => {
    fc.assert(
      fc.property(jsonObject, (obj) => {
        expect(JSON.parse(JSON.stringify(obj))).toStrictEqual(obj);
      }),
      RUN_OPTS,
    );
  });

  it("round-trips arbitrary OutputArtifact records", () => {
    fc.assert(
      fc.property(arbArtifact, (artifact) => {
        expect(JSON.parse(JSON.stringify(artifact))).toStrictEqual(artifact);
      }),
      RUN_OPTS,
    );
  });

  it("round-trips arbitrary PlatformAuditEvent records", () => {
    fc.assert(
      fc.property(arbAuditEvent, (event) => {
        expect(JSON.parse(JSON.stringify(event))).toStrictEqual(event);
      }),
      RUN_OPTS,
    );
  });
});

// ------------------------------------------------------------
// Property 1b - the store's (de)serialization round-trips a generated
// record without loss, exercising the real JSON.stringify on write and
// JSON.parse on read inside the SQLite stores.
// ------------------------------------------------------------

describe("fuzz: store (de)serialization round-trip", () => {
  it("SqliteArtifactStore.put/list round-trips arbitrary artifacts", () => {
    fc.assert(
      fc.property(arbArtifact, (artifact) => {
        const db = new FakeSqliteDatabase();
        const store = SqliteArtifactStore.fromDatabase(db);
        store.put(artifact);
        const [restored] = store.list(artifact.sessionId);
        expect(restored).toStrictEqual(artifact);
      }),
      RUN_OPTS,
    );
  });

  it("SqliteAgentSessionStore.create/get round-trips arbitrary sessions", () => {
    fc.assert(
      fc.property(arbSession, (session) => {
        const db = new FakeSqliteDatabase();
        const store = SqliteAgentSessionStore.fromDatabase(db);
        store.create(session);
        const restored = store.get(session.id);
        expect(restored).toStrictEqual(session);
      }),
      RUN_OPTS,
    );
  });
});

// ------------------------------------------------------------
// Property 2 - the JSON parse helper never throws on arbitrary input.
// The SQLite store's parseStoredJson wraps JSON.parse in try/catch and
// rethrows a sanitized error; we assert the underlying contract (parse
// of arbitrary text never escapes as an unhandled SyntaxError) and that
// the store surfaces a sanitized message rather than the raw payload.
// ------------------------------------------------------------

describe("fuzz: safe JSON parsing never throws", () => {
  it("safeParse returns a result and never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const result = safeParse(raw);
        // Always returns the tagged-union result; never throws.
        expect(typeof result.ok).toBe("boolean");
        if (result.ok) {
          // If it parsed, re-stringify/parse must be a fixed point.
          expect(JSON.parse(JSON.stringify(result.value))).toStrictEqual(result.value);
        }
      }),
      RUN_OPTS,
    );
  });

  it("matches a direct JSON.parse try/catch contract on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        let threw = false;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          threw = true;
        }
        const result = safeParse<unknown>(raw);
        // safeParse.ok is true exactly when JSON.parse did not throw.
        expect(result.ok).toBe(!threw);
        if (result.ok && !threw) {
          expect(result.value).toStrictEqual(parsed);
        }
      }),
      RUN_OPTS,
    );
  });

  it("store surfaces a sanitized parse error for corrupt JSON without leaking the payload", () => {
    fc.assert(
      fc.property(
        // Strings that are (almost certainly) not valid JSON so the
        // store's parse path takes the catch branch deterministically.
        fc.string().map((s) => `{not-json:${s}`),
        (corrupt) => {
          const db = new FakeSqliteDatabase();
          const store = SqliteAgentSessionStore.fromDatabase(db);
          const session: AgentSession = {
            id: "ses_fuzz",
            task: {
              id: "task_fuzz",
              title: "fuzz",
              goal: "fuzz",
              successCriteria: ["ok"],
            },
            trigger: { id: "trg_fuzz", kind: "manual", source: "test", firedAt: "2026-01-01T00:00:00.000Z" },
            status: "queued",
            artifacts: [],
            audit: [],
            priority: "normal",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          };
          store.create(session);
          db.corruptSessionJson(session.id, corrupt);

          let message = "";
          expect(() => {
            try {
              store.get(session.id);
            } catch (error) {
              message = error instanceof Error ? error.message : String(error);
              throw error;
            }
          }).toThrow("failed to parse stored JSON");
          // Sanitized: the raw corrupt payload is not echoed back.
          expect(message).not.toContain(corrupt);
        },
      ),
      RUN_OPTS,
    );
  });
});
