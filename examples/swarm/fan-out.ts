// ============================================================
// @oni.bot/core/swarm — Example: Fan-Out (Template API)
// ============================================================
// Uses SwarmGraph.fanOut() to run 3 research agents in parallel,
// then collect results through a reducer node.
// ============================================================

import {
  StateGraph, START, END,
} from "../../src/index.js";
import {
  SwarmGraph, baseSwarmChannels,
  type SwarmAgentDef, type BaseSwarmState,
} from "../../src/swarm/index.js";

// ----------------------------------------------------------------
// Build mock agent
// ----------------------------------------------------------------

function buildAgent(
  id: string,
  handler: (state: BaseSwarmState) => Partial<BaseSwarmState>,
): SwarmAgentDef<BaseSwarmState> {
  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", handler);
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [{ name: id, description: `Handles ${id}` }],
    skeleton: g.compile() as any,
  };
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  console.log("@oni.bot/core/swarm — Fan-Out Template Example");
  console.log("=".repeat(55));

  const swarm = SwarmGraph.fanOut<BaseSwarmState>({
    agents: [
      buildAgent("web-search", (state) => {
        console.log(`  [web-search] Searching web for: "${state.task}"`);
        return {
          messages: [{ role: "assistant", content: "Found 5 web articles" }],
        };
      }),
      buildAgent("paper-search", (state) => {
        console.log(`  [paper-search] Searching papers for: "${state.task}"`);
        return {
          messages: [{ role: "assistant", content: "Found 3 academic papers" }],
        };
      }),
      buildAgent("news-search", (state) => {
        console.log(`  [news-search] Searching news for: "${state.task}"`);
        return {
          messages: [{ role: "assistant", content: "Found 7 news articles" }],
        };
      }),
    ],
    reducer: (agentResults) => {
      const sources = Object.keys(agentResults);
      console.log(`  [reducer] Combining results from: ${sources.join(", ")}`);
      return {
        messages: [{
          role: "assistant",
          content: `Aggregated research from ${sources.length} sources`,
        }],
        done: true,
      };
    },
  });

  const app = swarm.compile();

  const result = await app.invoke({
    task: "Latest advances in multi-agent systems",
  });

  console.log("\nFan-out complete!");
  console.log("  Agent results:", Object.keys(result.agentResults));
  console.log("  Messages:", result.messages.length);

  console.log("\nAgent stats:");
  for (const [id, stats] of Object.entries(app.agentStats())) {
    console.log(`  ${id}: runs=${stats.totalRuns}`);
  }
}

main().catch(console.error);
