// ============================================================
// @oni.bot/core — Example: Send API (dynamic fan-out)
// ============================================================
// The Send API lets conditional edges dynamically dispatch to
// a node with a custom state patch — enabling true fan-out
// where each "branch" gets different arguments.
// ============================================================

import {
  StateGraph, START, END,
  Send, lastValue, appendList,
} from "../src/index.js";

type MapReduceState = {
  query:   string;
  chunks:  string[];
  results: string[];
  summary: string;
};

const graph = new StateGraph<MapReduceState>({
  channels: {
    query:   lastValue(() => ""),
    chunks:  appendList(() => []),
    results: appendList(() => []),
    summary: lastValue(() => ""),
  },
});

// Splitter — breaks query into chunks, sends each to "process" independently
graph.addNode("split", async (state) => {
  const chunks = state.query.split(" ").map((w, i) => `chunk-${i}:${w}`);
  console.log(`[split] created ${chunks.length} chunks`);
  return { chunks };
});

// Processor — receives a single chunk via Send args
graph.addNode("process", async (state) => {
  const last = state.chunks.at(-1) ?? "";
  console.log(`[process] processing: ${last}`);
  return { results: [`result(${last})`] };
});

// Reducer — aggregates all results
graph.addNode("reduce", async (state) => {
  const summary = `SUMMARY[${state.results.join(", ")}]`;
  console.log(`[reduce] ${summary}`);
  return { summary };
});

graph.addEdge(START, "split");

// Send each chunk to "process" independently (true fan-out)
graph.addConditionalEdges("split", (state) =>
  state.chunks.map((chunk, i) =>
    new Send("process", { chunks: [chunk] })
  )
);

graph.addEdge("process", "reduce");
graph.addEdge("reduce",  END);

const app = graph.compile();

async function main() {
  console.log("@oni.bot/core — Send API Example");
  console.log("=".repeat(50));

  const result = await app.invoke({ query: "oni core rocks" });
  console.log("\n✅ Results:", result.results);
  console.log("   Summary:", result.summary);
}

main().catch(console.error);
