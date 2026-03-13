// ============================================================
// @oni.bot/core/swarm — Example: Peer Network (Template API)
// ============================================================
// Uses SwarmGraph.peerNetwork() to create a decentralized agent
// network. Planner -> Coder -> Reviewer, with the Reviewer
// looping back to Coder if changes are needed.
// ============================================================

import {
  StateGraph, START, END,
  lastValue,
} from "../../src/index.js";
import {
  SwarmGraph, baseSwarmChannels,
  type SwarmAgentDef, type BaseSwarmState,
} from "../../src/swarm/index.js";

// ----------------------------------------------------------------
// Extended state for code review loop
// ----------------------------------------------------------------

type CodeSwarmState = BaseSwarmState & {
  plan: string;
  code: string;
  reviewNotes: string;
  revisions: number;
};

const codeChannels = {
  ...baseSwarmChannels,
  plan:        lastValue(() => ""),
  code:        lastValue(() => ""),
  reviewNotes: lastValue(() => ""),
  revisions:   lastValue(() => 0),
};

// ----------------------------------------------------------------
// Build mock agents
// ----------------------------------------------------------------

function buildAgent(
  id: string,
  handler: (state: CodeSwarmState) => Partial<CodeSwarmState>,
): SwarmAgentDef<CodeSwarmState> {
  const g = new StateGraph<CodeSwarmState>({ channels: codeChannels });
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
  console.log("@oni.bot/core/swarm — Peer Network Template Example");
  console.log("=".repeat(55));

  const swarm = SwarmGraph.peerNetwork<CodeSwarmState>({
    agents: [
      buildAgent("planner", (state) => {
        console.log(`  [planner] Planning: "${state.task}"`);
        return {
          plan: `Plan for "${state.task}": 1) Setup 2) Implement 3) Test`,
          messages: [{ role: "assistant", content: "Plan created." }],
        };
      }),
      buildAgent("coder", (state) => {
        const isRevision = state.revisions > 0;
        console.log(`  [coder] ${isRevision ? "Revising" : "Writing"} code (rev #${state.revisions})`);
        return {
          code: `// Code for: ${state.plan}\nfunction main() { /* impl */ }`,
          messages: [{ role: "assistant", content: `Code ${isRevision ? "revised" : "written"}.` }],
        };
      }),
      buildAgent("reviewer", (state) => {
        const pass = state.revisions >= 1;
        console.log(`  [reviewer] Reviewing... ${pass ? "APPROVED" : "CHANGES REQUESTED"}`);
        return {
          reviewNotes: pass ? "Looks good. Approved." : "Add error handling.",
          done: pass,
          revisions: state.revisions + (pass ? 0 : 1),
          messages: [{ role: "assistant", content: pass ? "Approved!" : "Changes needed." }],
        };
      }),
    ],
    entrypoint: "planner",
    handoffs: {
      planner:  () => "coder",
      coder:    () => "reviewer",
      reviewer: (state) => (state.done ? END : "coder"),
    },
    channels: codeChannels as any,
  });

  const app = swarm.compile();
  const result = await app.invoke({ task: "Build an API rate limiter" });

  console.log("\nSwarm complete!");
  console.log("  Plan:        ", result.plan);
  console.log("  Review notes:", result.reviewNotes);
  console.log("  Revisions:   ", result.revisions);
  console.log("  Messages:    ", result.messages.map((m) => m.content).join(" -> "));
}

main().catch(console.error);
