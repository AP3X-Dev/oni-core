// ============================================================
// @oni.bot/core — Example: Map-Reduce with Send
// ============================================================

import { StateGraph, START, END, lastValue, appendList, Send } from "../src/index.js";

type S = { topics: string[]; analyses: string[] };

const g = new StateGraph<S>({
  channels: {
    topics: lastValue(() => [] as string[]),
    analyses: appendList(() => [] as string[]),
  },
});

g.addNode("planner", async (state) => {
  console.log(`[planner] Dispatching ${state.topics.length} topics...`);
  return {};
});

g.addConditionalEdges("planner", (state) =>
  state.topics.map(t => new Send("analyst", { topics: [t] }))
);

g.addNode("analyst", async (state) => {
  const topic = state.topics[0];
  console.log(`  [analyst] Analyzing "${topic}"...`);
  return { analyses: [`Analysis of "${topic}": positive outlook`] };
});

g.addEdge("analyst", END);
g.addEdge(START, "planner");

const app = g.compile();

console.log("@oni.bot/core — Map-Reduce Example");
console.log("=".repeat(50));

const result = await app.invoke({
  topics: ["AI Safety", "Climate Tech", "Quantum Computing"],
  analyses: [],
});

console.log("\nCollected analyses:");
for (const a of result.analyses) console.log(`  - ${a}`);
