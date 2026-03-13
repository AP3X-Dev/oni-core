// ============================================================
// @oni.bot/core — Example: Messages Stream Mode (LLM token streaming)
// ============================================================

import {
  StateGraph, START, END, lastValue,
} from "../src/index.js";
import { getStreamWriter } from "../src/context.js";

type S = { response: string };

const g = new StateGraph<S>({
  channels: { response: lastValue(() => "") },
});

g.addNode("llm", async () => {
  const writer = getStreamWriter()!;

  // Simulate streaming LLM output token by token
  const words = ["Hello", " from", " ONI", " streaming", "!"];
  for (const w of words) {
    writer.token(w);
    await new Promise((r) => setTimeout(r, 100)); // simulate LLM latency
  }

  return { response: words.join("") };
});

g.addEdge(START, "llm");
g.addEdge("llm", END);

const app = g.compile();

console.log("@oni.bot/core — Messages Stream Mode Example");
console.log("=".repeat(50));

for await (const evt of app.stream({ response: "" }, { streamMode: "messages" })) {
  const e = evt as any;
  if (e.event === "messages") {
    process.stdout.write(e.data.chunk);
  }
  if (e.event === "messages/complete") {
    console.log("\n--- complete:", e.data.content);
  }
}
