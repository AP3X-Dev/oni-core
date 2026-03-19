import { describe, it, expect, vi } from "vitest";
import { CheckpointCorruptError } from "../errors.js";

// ---------------------------------------------------------------------------
// Helper: build a fake PgPool-shaped object and a Pool class that returns it
// ---------------------------------------------------------------------------
function makeFakePgModule(fakePool: { query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }) {
  class FakePool {
    query = fakePool.query;
    end = fakePool.end;
  }
  return {
    Pool: FakePool,
    default: { Pool: FakePool },
  };
}

// ---------------------------------------------------------------------------
// Helper: build and return a PostgresCheckpointer using a controlled fake pool
// ---------------------------------------------------------------------------
async function makeCheckpointer<S>(
  rows: Record<string, unknown>[],
): Promise<InstanceType<typeof import("../checkpointers/postgres.js").PostgresCheckpointer<S>>> {
  const pool = {
    query: vi.fn(),
    end: vi.fn(async () => {}),
  };

  pool.query
    .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE
    .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX
    .mockResolvedValue({ rows });         // subsequent queries return the test rows

  vi.doMock("pg", () => makeFakePgModule(pool));

  const { PostgresCheckpointer } = await import("../checkpointers/postgres.js");
  return PostgresCheckpointer.create<S>("postgresql://fake/fake");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("PostgresCheckpointer.deserialize (BUG-0046)", () => {
  it("BUG-0046: deserialize throws CheckpointCorruptError when row.step is a non-numeric string", async () => {
    // Before the fix, step was cast with bare `as number` — any non-numeric value
    // would silently propagate as NaN, corrupting checkpoint ordering.
    // After the fix, Number.isFinite() guard throws CheckpointCorruptError.
    const checkpointer = await makeCheckpointer([
      {
        thread_id: "t-step-nan",
        step: "not-a-number",   // simulates schema drift / corrupted column
        agent_id: null,
        state: JSON.stringify({ x: 1 }),
        next_nodes: JSON.stringify([]),
        pending_sends: JSON.stringify([]),
        metadata: null,
        pending_writes: null,
        timestamp: 1700000000000,
      },
    ]);

    await expect(checkpointer.get("t-step-nan")).rejects.toThrow(CheckpointCorruptError);
    await expect(checkpointer.get("t-step-nan")).rejects.toThrow(/invalid "step"/);
  });

  it("BUG-0046: deserialize throws CheckpointCorruptError when row.timestamp is undefined", async () => {
    // Number(undefined) === NaN which is not finite — guard must catch it.
    const checkpointer = await makeCheckpointer([
      {
        thread_id: "t-ts-undef",
        step: 1,
        agent_id: null,
        state: JSON.stringify({ x: 1 }),
        next_nodes: JSON.stringify([]),
        pending_sends: JSON.stringify([]),
        metadata: null,
        pending_writes: null,
        // timestamp intentionally omitted — arrives as undefined from schema drift
      },
    ]);

    await expect(checkpointer.get("t-ts-undef")).rejects.toThrow(CheckpointCorruptError);
    await expect(checkpointer.get("t-ts-undef")).rejects.toThrow(/invalid "timestamp"/);
  });

  it("BUG-0046: deserialize throws CheckpointCorruptError when row.step is NaN-producing string", async () => {
    // Regression guard: step must be a finite number, not an empty string coerced to NaN.
    const checkpointer = await makeCheckpointer([
      {
        thread_id: "t-step-empty",
        step: "",               // Number("") === 0, but Number("abc") would be NaN
        agent_id: null,
        state: JSON.stringify({}),
        next_nodes: JSON.stringify([]),
        pending_sends: JSON.stringify([]),
        metadata: null,
        pending_writes: null,
        timestamp: 1700000000000,
      },
    ]);

    // Number("") === 0 which is finite — this should succeed (boundary check)
    const result = await checkpointer.get("t-step-empty");
    expect(result).not.toBeNull();
    expect(result!.step).toBe(0);
  });

  it("BUG-0046: deserialize succeeds and preserves finite step and timestamp for valid rows", async () => {
    const checkpointer = await makeCheckpointer([
      {
        thread_id: "t-valid",
        step: 7,
        agent_id: "agent-x",
        state: JSON.stringify({ count: 99 }),
        next_nodes: JSON.stringify(["nodeA"]),
        pending_sends: JSON.stringify([]),
        metadata: null,
        pending_writes: null,
        timestamp: 1700000000000,
      },
    ]);

    const result = await checkpointer.get("t-valid");
    expect(result).not.toBeNull();
    expect(result!.step).toBe(7);
    expect(Number.isFinite(result!.step)).toBe(true);
    expect(result!.timestamp).toBe(1700000000000);
    expect(Number.isFinite(result!.timestamp)).toBe(true);
  });
});
