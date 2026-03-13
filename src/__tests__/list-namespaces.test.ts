import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../store/index.js";

describe("listNamespaces", () => {
  it("returns all unique namespaces", async () => {
    const store = new InMemoryStore();
    await store.put(["users", "alice"], "prefs", { theme: "dark" });
    await store.put(["users", "bob"], "prefs", { theme: "light" });
    await store.put(["agents", "researcher"], "facts", []);
    await store.put(["agents", "researcher"], "config", {});

    const namespaces = await store.listNamespaces();
    expect(namespaces.sort((a, b) => a.join("/").localeCompare(b.join("/")))).toEqual([
      ["agents", "researcher"],
      ["users", "alice"],
      ["users", "bob"],
    ]);
  });

  it("filters by prefix", async () => {
    const store = new InMemoryStore();
    await store.put(["users", "alice"], "k", 1);
    await store.put(["users", "bob"], "k", 2);
    await store.put(["agents", "x"], "k", 3);

    const ns = await store.listNamespaces({ prefix: ["users"] });
    expect(ns.sort((a, b) => a.join("/").localeCompare(b.join("/")))).toEqual([
      ["users", "alice"],
      ["users", "bob"],
    ]);
  });

  it("limits depth", async () => {
    const store = new InMemoryStore();
    await store.put(["a", "b", "c"], "k", 1);
    await store.put(["a", "b", "d"], "k", 2);
    await store.put(["a", "e"], "k", 3);

    const ns = await store.listNamespaces({ maxDepth: 1 });
    const sorted = ns.sort((a, b) => a.join("/").localeCompare(b.join("/")));
    expect(sorted).toEqual([["a"]]);
  });

  it("returns empty for empty store", async () => {
    const store = new InMemoryStore();
    expect(await store.listNamespaces()).toEqual([]);
  });
});
