// ============================================================
// @oni.bot/core/swarm — Example: Map-Reduce (Template API)
// ============================================================
// Uses SwarmGraph.mapReduce() to process 3 documents across a
// pool of 2 analyst agents, then reduce results into a summary.
// ============================================================

import {
  StateGraph, START, END,
  lastValue, appendList,
} from "../../src/index.js";
import {
  SwarmGraph, baseSwarmChannels,
  type BaseSwarmState,
} from "../../src/swarm/index.js";

// ----------------------------------------------------------------
// Extended state with documents array
// ----------------------------------------------------------------

type DocState = BaseSwarmState & {
  documents: string[];
  summary: string;
};

const docChannels = {
  ...baseSwarmChannels,
  documents: appendList(() => [] as string[]),
  summary:   lastValue(() => ""),
};

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  console.log("@oni.bot/core/swarm — Map-Reduce Template Example");
  console.log("=".repeat(55));

  const analyzerSkeleton = (() => {
    const g = new StateGraph<DocState>({ channels: docChannels });
    g.addNode("work", (state) => {
      console.log(`  [analyst] Analyzing: "${state.task}"`);
      return {
        messages: [{ role: "assistant", content: `Analysis of "${state.task}": 150 words, positive tone` }],
      };
    });
    g.addEdge(START, "work");
    g.addEdge("work", END);
    return g.compile();
  })();

  const swarm = SwarmGraph.mapReduce<DocState>({
    mapper: {
      id: "analyst",
      role: "Document Analyst",
      capabilities: [{ name: "analyze", description: "Analyzes documents" }],
      skeleton: analyzerSkeleton as any,
    },
    poolSize: 2,
    poolStrategy: "round-robin",
    inputField: "documents",
    reducer: (agentResults) => {
      const analyses = Object.keys(agentResults);
      console.log(`  [reducer] Combining ${analyses.length} analyses`);
      return {
        summary: `Combined analysis of ${analyses.length} documents complete`,
        done: true,
      } as Partial<DocState>;
    },
    channels: docChannels as any,
  });

  const app = swarm.compile();

  const result = await app.invoke({
    task: "Batch document analysis",
    documents: [
      "Q4 Earnings Report",
      "Market Research Summary",
      "Competitor Analysis Brief",
    ],
  });

  console.log("\nMap-reduce complete!");
  console.log("  Summary:", result.summary);
  console.log("  Agent results:", Object.keys(result.agentResults));

  console.log("\nAgent stats:");
  for (const [id, stats] of Object.entries(app.agentStats())) {
    console.log(`  ${id}: runs=${stats.totalRuns}`);
  }
}

main().catch(console.error);
