// ============================================================
// @oni.bot/core — Example: Runtime Context (getConfig, getStore)
// ============================================================

import {
  StateGraph, START, END, lastValue,
} from "../src/index.js";
import { getConfig, getStore } from "../src/context.js";
import { InMemoryStore } from "../src/store/index.js";

type S = { result: string };

const store = new InMemoryStore();
await store.put(["prefs"], "theme", "dark");

const g = new StateGraph<S>({
  channels: { result: lastValue(() => "") },
});

g.addNode("reader", async () => {
  const cfg  = getConfig();
  const s    = getStore();
  const item = await s!.get<string>(["prefs"], "theme");
  return { result: `thread=${cfg.threadId} theme=${item?.value}` };
});

g.addEdge(START, "reader");
g.addEdge("reader", END);

const app = g.compile({ store });
const res = await app.invoke({ result: "" }, { threadId: "demo" });
console.log("Result:", res.result);
// → thread=demo theme=dark
