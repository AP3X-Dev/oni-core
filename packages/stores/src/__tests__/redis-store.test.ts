import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RedisStore } from "../redis/index.js";

const REDIS_URL = process.env["REDIS_URL"];

describe.skipIf(!REDIS_URL)("RedisStore integration", () => {
  let store: RedisStore;

  beforeAll(async () => {
    store = await RedisStore.create({ url: REDIS_URL!, prefix: `test-${Date.now()}` });
  });

  afterAll(async () => {
    await store.close();
  });

  it("put and get", async () => {
    await store.put(["test"], "key1", { hello: "world" });
    const item = await store.get(["test"], "key1");
    expect(item?.value).toEqual({ hello: "world" });
  });

  it("preserves createdAt on update", async () => {
    await store.put(["test"], "update-key", "first");
    const first = await store.get(["test"], "update-key");
    await store.put(["test"], "update-key", "second");
    const second = await store.get(["test"], "update-key");
    expect(second?.createdAt).toBe(first?.createdAt);
    expect(second?.value).toBe("second");
  });

  it("delete", async () => {
    await store.put(["test"], "to-delete", "value");
    await store.delete(["test"], "to-delete");
    expect(await store.get(["test"], "to-delete")).toBeNull();
  });

  it("list", async () => {
    await store.put(["test-list"], "a", 1);
    await store.put(["test-list"], "b", 2);
    const items = await store.list(["test-list"]);
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("search with substring", async () => {
    await store.put(["search-test"], "item1", { content: "hello world" });
    const results = await store.search(["search-test"], "hello");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search with filter", async () => {
    await store.put(["filter-test"], "a", { type: "foo", val: 1 });
    await store.put(["filter-test"], "b", { type: "bar", val: 2 });
    const results = await store.search(["filter-test"], "val", {
      filter: { type: "foo" },
    });
    expect(results.length).toBe(1);
    expect((results[0]!.item.value as { type: string }).type).toBe("foo");
  });

  it("listNamespaces", async () => {
    await store.put(["ns", "a"], "k", 1);
    await store.put(["ns", "b"], "k", 2);
    const nses = await store.listNamespaces({ prefix: ["ns"] });
    const strs = nses.map(n => JSON.stringify(n));
    expect(strs).toContain(JSON.stringify(["ns", "a"]));
    expect(strs).toContain(JSON.stringify(["ns", "b"]));
  });

  it("listNamespaces with maxDepth", async () => {
    await store.put(["depth", "a", "b"], "k", 1);
    const nses = await store.listNamespaces({ prefix: ["depth"], maxDepth: 1 });
    expect(nses.every(n => n.length <= 2)).toBe(true);
  });

  it("TTL expiry — item vanishes after TTL", async () => {
    await store.put(["ttl-test"], "short", "bye", { ttl: 50 });
    const before = await store.get(["ttl-test"], "short");
    expect(before?.value).toBe("bye");
    await new Promise(r => setTimeout(r, 100));
    const after = await store.get(["ttl-test"], "short");
    expect(after).toBeNull();
  });
});

describe("RedisStore (no Redis)", () => {
  it("RedisStore class is exported", () => {
    expect(RedisStore).toBeDefined();
    expect(typeof RedisStore.create).toBe("function");
  });
});
