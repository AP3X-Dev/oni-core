// ============================================================
// @oni.bot/core — Example: Multiple Stream Modes
// ============================================================

import { StateGraph, START, END, lastValue } from "../src/index.js";
import { getStreamWriter } from "../src/context.js";

type S = { response: string };

const g = new StateGraph<S>({
  channels: { response: lastValue(() => "") },
});

g.addNode("llm", async () => {
  const writer = getStreamWriter()!;
  for (const word of ["Hello", " World", "!"]) {
    writer.token(word);
  }
  return { response: "Hello World!" };
});

g.addEdge(START, "llm");
g.addEdge("llm", END);

const app = g.compile();

console.log("@oni.bot/core — Multiple Stream Modes Example");
console.log("=".repeat(50));

for await (const evt of app.stream(
  { response: "" },
  { streamMode: ["values", "messages"] },
)) {
  const e = evt as any;
  console.log(`[${e.mode}] ${e.event}:`, e.data?.chunk ?? JSON.stringify(e.data).slice(0, 60));
}
