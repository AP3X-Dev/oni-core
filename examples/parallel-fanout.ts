// ============================================================
// @oni.bot/core — Example: Parallel Fan-out Skeleton
// ============================================================

import { StateGraph, START, END, lastValue, appendList } from "../src/index.js";

type ResearchState = {
  query: string;
  webResults: string[];
  newsResults: string[];
  summary: string;
};

const skeleton = new StateGraph<ResearchState>({
  channels: {
    query:       lastValue(() => ""),
    webResults:  appendList(() => []),
    newsResults: appendList(() => []),
    summary:     lastValue(() => ""),
  },
});

skeleton.addNode("web_search", async (state) => {
  console.log(`[web_search] "${state.query}"`);
  await new Promise((r) => setTimeout(r, 100));
  return { webResults: [`Web: ${state.query}`] };
});

skeleton.addNode("news_search", async (state) => {
  console.log(`[news_search] "${state.query}"`);
  await new Promise((r) => setTimeout(r, 80));
  return { newsResults: [`News: ${state.query}`] };
});

skeleton.addNode("summarize", async (state) => {
  const combined = [...state.webResults, ...state.newsResults];
  return { summary: `ONI Summary: ${combined.join(" | ")}` };
});

// Fan-out: both search nodes activate in the same superstep
skeleton.addEdge(START, "web_search");
skeleton.addEdge(START, "news_search");

// Fan-in: summarize runs once after both complete
skeleton.addEdge("web_search", "summarize");
skeleton.addEdge("news_search", "summarize");
skeleton.addEdge("summarize", END);

const app = skeleton.compile();

async function main() {
  console.log("@oni.bot/core — Parallel Fan-out Skeleton");
  console.log("=".repeat(50));
  const result = await app.invoke({ query: "ONI Platform" });
  console.log("\n✅ Summary:", result.summary);
}

main().catch(console.error);
