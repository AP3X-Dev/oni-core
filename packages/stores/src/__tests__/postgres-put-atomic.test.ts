import { describe, it, expect, vi } from "vitest";
import { PostgresStore } from "../postgres/index.js";
import type { PgClient } from "../postgres/types.js";

describe("PostgresStore.put atomicity", () => {
  it("BUG-0005: should use a single atomic INSERT...ON CONFLICT to prevent createdAt race", async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [] });
    const mockClient: PgClient = { query: querySpy };

    // Bypass private constructor to inject mock client
    const store = Object.create(PostgresStore.prototype) as PostgresStore;
    Object.assign(store, { client: mockClient, prefix: "test" });

    await store.put(["ns"], "key1", { hello: "world" });

    // The fix: put() must make exactly ONE query (atomic upsert), not two (SELECT then INSERT)
    expect(querySpy).toHaveBeenCalledOnce();

    const sql = querySpy.mock.calls[0]![0] as string;

    // Must use ON CONFLICT for atomic upsert
    expect(sql).toContain("ON CONFLICT");

    // Must preserve existing created_at on conflict (not overwrite with new value)
    expect(sql).toContain("created_at = oni_store.created_at");
  });
});
