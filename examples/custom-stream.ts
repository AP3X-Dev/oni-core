// ============================================================
// @oni.bot/core — Example: Custom Stream Mode + getStreamWriter()
// ============================================================

import {
  StateGraph, START, END, lastValue,
} from "../src/index.js";
import { getStreamWriter } from "../src/context.js";

type S = { value: string };

const g = new StateGraph<S>({
  channels: { value: lastValue(() => "") },
});

g.addNode("worker", async () => {
  const writer = getStreamWriter()!;
  writer.emit("progress", { percent: 0, stage: "starting" });
  // ... do some work ...
  writer.emit("progress", { percent: 50, stage: "processing" });
  // ... more work ...
  writer.emit("progress", { percent: 100, stage: "complete" });
  return { value: "done" };
});

g.addEdge(START, "worker");
g.addEdge("worker", END);

const app = g.compile();

console.log("@oni.bot/core — Custom Stream Mode Example");
console.log("=".repeat(50));

for await (const evt of app.stream({ value: "" }, { streamMode: "custom" })) {
  if ((evt as any).event === "custom") {
    const e = evt as any;
    console.log(`[${e.name}]`, e.data);
  }
}
