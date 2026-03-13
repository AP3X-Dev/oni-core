// ============================================================
// @oni.bot/core/swarm — Example: Hierarchical Swarm (Template API)
// ============================================================
// Uses SwarmGraph.hierarchical() to create a supervisor-workers
// swarm with rule-based routing. Three agents: researcher,
// writer, critic — routed sequentially by round number.
// ============================================================

import {
  StateGraph, START, END,
} from "../../src/index.js";
import {
  SwarmGraph, baseSwarmChannels,
  type SwarmAgentDef, type BaseSwarmState,
} from "../../src/swarm/index.js";

// ----------------------------------------------------------------
// Build mock agent skeletons
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
    capabilities: [{ name: id, description: `Handles ${id} tasks` }],
    skeleton: g.compile() as any,
  };
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  console.log("@oni.bot/core/swarm — Hierarchical Template Example");
  console.log("=".repeat(55));

  const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
    supervisor: {
      strategy: "rule",
      maxRounds: 4,
      rules: [
        { condition: (_, ctx) => ((ctx.round as number) ?? 0) === 0, agentId: "researcher" },
        { condition: (_, ctx) => ((ctx.round as number) ?? 0) === 1, agentId: "writer" },
        { condition: (_, ctx) => ((ctx.round as number) ?? 0) === 2, agentId: "critic" },
      ],
    },
    agents: [
      buildAgent("researcher", (state) => {
        console.log(`  [researcher] Researching: "${state.task}"`);
        return {
          messages: [{ role: "assistant", content: `Found 3 sources on "${state.task}"` }],
        };
      }),
      buildAgent("writer", (state) => {
        console.log(`  [writer] Writing draft on: "${state.task}"`);
        return {
          messages: [{ role: "assistant", content: `Draft written for "${state.task}"` }],
        };
      }),
      buildAgent("critic", (_state) => {
        console.log("  [critic] Reviewing output");
        return {
          messages: [{ role: "assistant", content: "Critique: Looks solid. Approved." }],
          done: true,
        };
      }),
    ],
  });

  const app = swarm.compile();

  const result = await app.invoke({
    task: "The future of multi-agent AI systems",
    context: { round: 0 },
  });

  console.log("\nSwarm complete!");
  console.log("  Messages:", result.messages.length);
  console.log("  Rounds:  ", result.supervisorRound);
  for (const msg of result.messages) {
    console.log(`  [${msg.role}] ${msg.content}`);
  }

  console.log("\nAgent stats:");
  for (const [id, stats] of Object.entries(app.agentStats())) {
    console.log(`  ${id}: runs=${stats.totalRuns} errors=${stats.errors}`);
  }
}

main().catch(console.error);
